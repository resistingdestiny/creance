import type { FastifyPluginAsync } from 'fastify';
import { headline } from '@creance/index-model';

import { AppError } from '../errors.js';
import { seriesForGroup } from '../config.js';
import { periodFromInteger } from '../index-data.js';
import type { ObservationRow } from '../db/types.js';
import type { Services } from '../services.js';
import { periodLabel, points, rfc3339 } from '../views.js';

/// GET /v1/index/:group
///
/// The latest reading, the last twenty-four months and the trigger status, from
/// the `observations` table. DESIGN.md 3.7 makes this a metered feed; T08 puts
/// the x402 gate in front of it and nothing about the payload changes then.
///
/// Every index value is a decimal string, never a JSON number. The thresholds
/// are `int64` scaled by 1e4 on chain and a float round trip through JSON is
/// the one way this build could publish a number that does not match the one
/// the contract compared.

export const HISTORY_MONTHS = 24;

export const indexRoutes: FastifyPluginAsync<{ services: Services }> = async (app, options) => {
  const { services } = options;

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
