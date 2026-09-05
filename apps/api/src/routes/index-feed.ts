import type { FastifyPluginAsync } from 'fastify';
import { headline } from '@creance/index-model';

import { AppError } from '../errors.js';
import { seriesForGroup } from '../config.js';
import { periodFromInteger } from '../index-data.js';
import type { ObservationRow } from '../db/types.js';
import type { Services } from '../services.js';
import { periodLabel, points, rfc3339 } from '../views.js';
import { EXACT_SCHEME, X402_VERSION } from '../x402/config.js';

/// The public index feed.
///
///     GET /v1/index          the catalogue, free
///     GET /v1/index/:group   one group's reading, metered
///
/// The reading is the latest observation, the last twenty-four months and the
/// trigger status, from the `observations` table. DESIGN.md 3.7 makes it a
/// metered feed and the x402 gate in apps/api/src/x402 is in front of it,
/// priced per call; nothing about this payload changes because of that.
///
/// The catalogue is free and deliberately so. Until T28 there was no way for a
/// caller to learn a valid group key without paying for a reading, and paying
/// 0.01 TUSD to find out that a guess was wrong is not a feed anyone would
/// build an agent against. It answers what an agent needs before it spends
/// anything: the fifteen group keys, the frozen trigger lines, which groups
/// have a reading at all, and what a reading costs. It carries no index values,
/// so nothing that is sold by the metered route is given away by this one.
///
/// The path is `/v1/index` and not `/v1/index/something`, because the gate
/// meters `GET /v1/index/*`. A free route under that prefix would answer 402 as
/// soon as payments are configured, which is how the replay badge had to move
/// out from under it in T12. A test holds this one open with the gate on.
///
/// Every index value is a decimal string, never a JSON number. The thresholds
/// are `int64` scaled by 1e4 on chain and a float round trip through JSON is
/// the one way this build could publish a number that does not match the one
/// the contract compared.

export const HISTORY_MONTHS = 24;

/// What the two trigger forms are, in the words an agent needs to read a
/// reading. DESIGN.md 3.3 and docs/INDEX-SPEC.md section 4 are the definitions;
/// these sentences say what they mean and must not drift from them.
export const TRIGGER_FORMS = [
  {
    form: 'shock',
    field: 'odi',
    threshold: 'attachment_shock',
    test: 'odi >= attachment_shock',
    means:
      'An abrupt dislocation. The ODI is how much the occupation has lost ground against all occupations in the last twelve months, so the shock form opens when the deterioration is fast.',
  },
  {
    form: 'level',
    field: 'ebar',
    threshold: 'level_line',
    test: 'ebar >= level_line',
    means:
      'A slow grind. The smoothed excess is how far the occupation sits above all occupations right now, so the level form opens when the occupation has settled at a worse level than its own history, which year on year differencing removes. A level line can be negative: for an occupation with low unemployment the trigger is deterioration against its own past, not high unemployment in absolute terms.',
  },
] as const;

export const indexRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

  app.get('/v1/index', async (_request, reply) => {
    const groups = await services.repository.groups();
    const latest = new Map(
      (await services.repository.latestPeriods()).map((row) => [row.groupKey, row.period]),
    );
    const price = services.x402?.config ?? null;

    return reply.send({
      index: {
        name: 'Occupation Displacement Index',
        unit: 'percentage points',
        cadence: 'monthly',
        source: 'US Bureau of Labor Statistics, Current Population Survey, unemployment rate by occupation, not seasonally adjusted',
        // Where the settled record is. An agent that does not want to trust
        // this API can read the same observations off the topic.
        topic_id: services.config.indexTopicId === '' ? null : services.config.indexTopicId,
        mirror_url: services.config.mirrorUrl,
      },
      // What a reading is, before anyone pays for one.
      reading: {
        path: '/v1/index/{group}',
        history_months: HISTORY_MONTHS,
        describes:
          'The newest published month for one occupation group, the twenty-four months before it, and whether claims are open. Values are decimal strings in percentage points.',
        fields: {
          u_g: 'The unemployment rate for the occupation group.',
          u_all: 'The unemployment rate across all occupations.',
          e: 'The excess, u_g less u_all.',
          ebar: 'The excess smoothed over three months.',
          odi: 'The index: this month ebar less the same month a year ago.',
        },
      },
      trigger_forms: TRIGGER_FORMS,
      // The terms, so the decision to call the metered route can be taken from
      // this response alone. Null when this deployment serves the feed open,
      // which a clone with no Hedera keys does.
      price:
        price === null
          ? null
          : {
              amount: price.index.amount,
              display: price.index.display,
              asset: price.asset,
              decimals: price.assetDecimals,
              symbol: price.assetSymbol,
              x402_version: X402_VERSION,
              scheme: EXACT_SCHEME,
              network: price.network,
              pay_to: price.payTo,
              facilitator: price.facilitatorUrl,
            },
      groups: groups.map((group) => {
        const thresholds = services.thresholds.get(group.groupKey) ?? null;
        const period = latest.get(group.groupKey);
        return {
          group: group.groupKey,
          label: group.label,
          bls_series: group.blsSeries,
          series_id: seriesForGroup(services.config, group.groupKey)?.label ?? null,
          // Frozen at issuance, published on every observation on the topic and
          // in the series terms, so there is nothing here to withhold.
          attachment_shock: thresholds === null ? null : thresholds.attachmentShock.toFixed(2),
          level_line: thresholds === null ? null : thresholds.levelLine.toFixed(2),
          // Which groups are worth paying for. A group with no reading answers
          // 503 after taking the payment, and an agent should be able to see
          // that coming.
          latest_period: period === undefined ? null : periodLabel(period),
        };
      }),
    });
  });

  app.get<{ Params: { group: string } }>('/v1/index/:group', async (request, reply) => {
    const groupKey = request.params.group;
    const group = await services.repository.group(groupKey);
    if (group === null) {
      throw new AppError(
        400,
        'group_unknown',
        'Unknown occupation',
        'That is not one of the fifteen occupation groups this index covers.',
      );
    }

    const rows = await services.repository.observations(groupKey, HISTORY_MONTHS);
    if (rows.length === 0) {
      throw new AppError(
        503,
        'index_unavailable',
        'No index yet',
        'No observation has been published for that occupation yet.',
      );
    }
    // The repository answers newest first; the history reads oldest first,
    // which is the order a chart draws in.
    const latest = rows[0] as ObservationRow;
    const history = [...rows].reverse();

    const series = seriesForGroup(services.config, groupKey);
    const thresholds = services.thresholds.get(groupKey) ?? { attachmentShock: 0, levelLine: 0 };
    const reading = headline({
      groupKey,
      seriesId: latest.source ?? '',
      period: periodFromInteger(latest.period),
      uG: latest.uG,
      uAll: latest.uAll,
      e: latest.e,
      ebar: latest.ebar,
      ebarBase: null,
      odi: latest.odi,
      attachmentShock: thresholds.attachmentShock,
      levelLine: thresholds.levelLine,
      forms: [],
      levelOpen: latest.openReason === 'level' || latest.openReason === 'both',
      shockOpen: latest.openReason === 'shock' || latest.openReason === 'both',
      open: latest.open,
      openReason: latest.openReason ?? 'none',
      status: 'final',
    });

    return reply.send({
      group: groupKey,
      group_label: group.label,
      series_id: series?.label ?? null,
      as_of: periodLabel(latest.period),
      reading: {
        period: periodLabel(latest.period),
        u_g: points(latest.uG),
        u_all: points(latest.uAll),
        e: points(latest.e),
        ebar: points(latest.ebar),
        odi: points(latest.odi),
      },
      trigger: {
        attachment_shock: thresholds.attachmentShock.toFixed(2),
        level_line: thresholds.levelLine.toFixed(2),
        open: latest.open,
        open_reason: latest.openReason,
        shock_margin: margin(latest.odi, thresholds.attachmentShock),
        level_margin: margin(latest.ebar, thresholds.levelLine),
      },
      // Which form is nearer its line, chosen here so that two screens cannot
      // choose differently: docs/DECISIONS.md, "The headline index figure is
      // whichever form is nearer its line, chosen server side".
      headline:
        reading === null
          ? null
          : {
              form: reading.form,
              distance: reading.distance.toFixed(2),
              on_the_line: reading.onTheLine,
              open: reading.open,
            },
      history: history.map((row) => ({
        period: periodLabel(row.period),
        u_g: points(row.uG),
        u_all: points(row.uAll),
        e: points(row.e),
        ebar: points(row.ebar),
        odi: points(row.odi),
        open: row.open,
        open_reason: row.openReason,
      })),
      source: {
        series: latest.source,
        hash: latest.sourceHash,
        model_version: latest.modelVersion,
        replay: latest.replay,
      },
      // No HCS sequence number and no on-chain submission id yet: the oracle
      // that publishes them is T12, and these rows were computed from the
      // committed archive rather than published. The fields are here so a
      // reader can see they are empty rather than absent.
      publication: {
        topic_id: latest.hcsTopic,
        sequence_number: latest.hcsSeq,
        submit_transaction: latest.submitTx,
      },
      updated_at: rfc3339(latest.computedAt),
    });
  });
};

function margin(value: number | null, threshold: number): string | null {
  return value === null ? null : (value - threshold).toFixed(2);
}
