import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActivityScreen, NO_ACTIVITY } from '../src/app/activity/activity-screen.js';
import { PER_SOURCE_ON_A_PAGE, type ActivityFeed } from '../src/lib/activity-data.js';
import { ACTIVITY_SOURCES, type ActivityRun } from '../src/lib/activity-model.js';

/**
 * What the activity page shows, and what it refuses to show.
 *
 * The page is the product's answer to "is any of this real", so the two things
 * held here are that every line on it can be checked and that a line is never
 * manufactured. A feed with nothing in it renders no rows at all and says why,
 * because a page that filled an empty stream with an example would be worse than
 * a page that said nothing.
 */

const NOW = Date.parse('2026-09-12T09:00:00.000Z');

function run(over: Partial<ActivityRun> = {}): ActivityRun {
  return {
    key: 'payments-7942',
    source: 'payments',
    at: '2026-09-12T08:36:04.922Z',
    since: '2026-09-12T08:36:04.922Z',
    consensus: '1789202164.922804104',
    title: 'An agent paid for a price',
    detail: 'POST /v1/quote',
    count: 1,
    total: { minor: '50000', decimals: 6 },
    refused: false,
    href: 'https://hashscan.io/testnet/transaction/0.0.10366450-1789202159-814712667',
    ...over,
  };
}

function feed(over: Partial<ActivityFeed> = {}): ActivityFeed {
  return {
    runs: [run()],
    summarised: false,
    unread: [],
    readAt: '2026-09-12T09:00:00.000Z',
    older: null,
    ...over,
  };
}

function render(view: ActivityFeed, filter: Parameters<typeof ActivityScreen>[0]['filter'] = null) {
  return renderToStaticMarkup(
    <ActivityScreen before={null} feed={view} filter={filter} now={NOW} />,
  );
}

describe('the activity page', () => {
  const markup = render(feed());

  it('stands in the desktop frame under the product header, on canvas', () => {
    expect(markup).toContain('bg-night');
    expect(markup).toContain('min-h-frame py-12 mx-auto w-full max-w-[1280px] px-5 lg:px-10');
    // One piece of chrome. The second header element is the page's own heading
    // block, which is what the market board does inside the same frame.
    expect(markup.match(/data-tone="night"/g)).toHaveLength(1);
  });

  it('says where it stands in the header', () => {
    expect(/<a[^>]*aria-current="page"[^>]*>Activity<\/a>/.test(markup)).toBe(true);
  });

  it('says what happened, when, and how much moved', () => {
    expect(markup).toContain('An agent paid for a price');
    expect(markup).toContain('23 minutes ago');
    expect(markup).toContain('12 September, 08:36');
    expect(markup).toContain('0.05');
  });

  it('links every line to its own record on HashScan, in a new tab', () => {
    const link =
      /<a[^>]*href="https:\/\/hashscan\.io\/testnet\/transaction\/0\.0\.10366450-1789202159-814712667"[^>]*>/.exec(
        markup,
      )?.[0] ?? '';
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noreferrer"');
  });

  it('offers every one of the seven places as a filter, in the address', () => {
    expect(markup).toContain('href="/activity"');
    for (const source of ACTIVITY_SOURCES) {
      expect(markup, source.key).toContain(`href="/activity?source=${source.key}"`);
    }
  });

  it('names every place it read, with its id, so the page can be checked without it', () => {
    for (const source of ACTIVITY_SOURCES) {
      expect(markup, source.key).toContain(source.id);
      expect(markup, source.key).toContain(
        `https://hashscan.io/testnet/${source.kind}/${source.id}`,
      );
    }
  });

  it('says how a page is summarised, rather than letting it look complete', () => {
    const line = `no place takes more than ${String(PER_SOURCE_ON_A_PAGE)} lines of a page`;
    expect(markup).not.toContain(line);
    const summarised = render(feed({ summarised: true }));
    expect(summarised).toContain(line);
    expect(summarised).toContain('one line with a count and a total');
    expect(summarised).toContain('every one of its records on its own');
  });

  it('needs no script, no session and no wallet', () => {
    expect(markup).not.toContain('IntersectionObserver');
    expect(markup).not.toContain('onScroll');
    expect(markup).not.toContain('Connect');
  });
});

describe('when the mirror node cannot be read', () => {
  it('shows nothing at all and says so', () => {
    const markup = render(feed({ runs: [], unread: ['payments', 'claims'] }));
    expect(markup).toContain(NO_ACTIVITY.title);
    expect(markup).toContain(NO_ACTIVITY.line);
    expect(markup).not.toContain('<table');
    expect(markup).not.toContain('hashscan.io/testnet/transaction');
  });

  it('names the places that did not answer when the rest of the page still stands', () => {
    const markup = render(feed({ unread: ['index'] }));
    expect(markup).toContain('could not be read when this page was built');
    expect(markup).toContain('An agent paid for a price');
  });
});

describe('a line the chain refused', () => {
  it('is still shown, because a refusal is the control working', () => {
    const markup = render(
      feed({
        runs: [
          run({ title: 'Notes changed hands', refused: true, detail: 'The chain refused it' }),
        ],
      }),
    );
    expect(markup).toContain('Notes changed hands');
    expect(markup).toContain('Refused');
    expect(markup).toContain('hashscan.io/testnet/transaction');
  });
});

describe('a line standing for a run of records', () => {
  const one = render(feed());
  const rolled = render(
    feed({
      summarised: true,
      runs: [
        run({
          count: 15,
          since: '2026-09-12T08:34:19.000Z',
          at: '2026-09-12T08:36:04.922Z',
          title: 'An agent paid to read the index',
          detail: 'GET /v1/index/:group',
          total: { minor: '150000', decimals: 6 },
        }),
      ],
    }),
  );

  it('says how many it stands for and over what span', () => {
    expect(rolled).toContain('15 times');
    expect(rolled).toContain('12 September, 08:34 to 08:36');
  });

  it('shows the sum and calls it a total, so nobody reads it as one call', () => {
    expect(rolled).toContain('0.15');
    expect(rolled).toContain('>total<');
  });

  it('says its link is one of them, not all of them', () => {
    expect(rolled).toContain('See the newest of them on HashScan');
    expect(rolled).not.toContain('>See it on HashScan<');
  });

  it('changes nothing at all for a run of one', () => {
    expect(one).toContain('>See it on HashScan<');
    expect(one).not.toContain('times');
    expect(one).not.toContain('>total<');
    expect(one).toContain('0.05');
  });
});

describe('the way back through the history', () => {
  it('is offered only where there is one, and is not for a crawler to walk', () => {
    expect(render(feed())).not.toContain('Older activity');
    const paged = render(feed({ older: '1789202100.000000000' }));
    expect(paged).toContain('href="/activity?before=1789202100.000000000"');
    expect(/<a[^>]*before=1789202100[^>]*rel="nofollow"/.test(paged)).toBe(true);
  });

  it('keeps the filter it was reached with', () => {
    const paged = render(feed({ older: '1789202100.000000000' }), 'market');
    expect(paged).toContain('href="/activity?source=market&amp;before=1789202100.000000000"');
  });
});
