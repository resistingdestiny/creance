'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

import { AmountSlider } from '../../components/amount-slider';
import { AppFrame } from '../../components/app-frame';
import { BottomSheet } from '../../components/bottom-sheet';
import { CheckboxRow } from '../../components/checkbox-row';
import { CopyButton } from '../../components/copy-button';
import { CoverCard } from '../../components/cover-card';
import { DisplayNumber } from '../../components/display-number';
import { FormField } from '../../components/form-field';
import { IndexChart, type IndexPoint } from '../../components/index-chart';
import { ListRow } from '../../components/list-row';
import { PillButton } from '../../components/pill-button';
import { ReplayBar } from '../../components/replay-bar';
import { SegmentedToggle } from '../../components/segmented-toggle';
import { Skeleton, SkeletonChart, SkeletonFigure, SkeletonRow } from '../../components/skeleton';
import { StatusPill } from '../../components/status-pill';
import { SurfaceGroup } from '../../components/surface-group';
import { TabBar } from '../../components/tab-bar';
import { DataTable } from '../../components/table';
import { TextLink } from '../../components/text-link';
import { FailureBody, OFFLINE, PAYMENT_FAILED, Toast } from '../../components/toast';
import { UploadArea } from '../../components/upload-area';
import type { CardTreatment } from '../../lib/font-option';
import { formatAmount, formatMoney, shortenAddress } from '../../lib/format';
import {
  CANVAS,
  COLOUR_TOKENS,
  SURFACE,
  contrastRatio,
  formatRatio,
  passesTextFloor,
} from '../../lib/tokens';
import { DEMO_ACCOUNT, DEMO_WALLET_LABEL } from '../../lib/wallet';

/**
 * Every component in docs/DESIGN-TOKENS.md section 7, in every state, on one
 * page. It is the acceptance surface for T10 and it is where a reviewer checks
 * a claim like "no drop shadows anywhere" in ten seconds instead of ten
 * minutes.
 *
 * Two rules that this page exists to keep honest:
 *
 * - a bare `border` in Tailwind v4 paints currentColor, so every hairline here
 *   is `border border-hairline`;
 * - the focus state is an outline, never one of the framework rings. The
 *   ".focus-demo" class paints
 *   the same outline on an element that does not have focus so it can be seen
 *   without holding the tab key down.
 */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-hairline py-10" id={id}>
      <h2 className="text-title font-display font-semibold tracking-title text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Case({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption text-ink-2">{label}</p>
      {children}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 sm:grid-cols-2">{children}</div>;
}

/**
 * The three home directions of the design file. Each pairs one card treatment
 * with one typeface, and NEXT_PUBLIC_FONT_OPTION picks the pair the product
 * builds.
 */
const HOME_DIRECTIONS: {
  code: string;
  name: string;
  typeface: string;
  /** The .type-specimen modifier that names this direction's family. */
  specimen: string;
  treatment: CardTreatment;
}[] = [
  { code: '1a', name: 'Wallet card', specimen: 'type-specimen--a', treatment: 'wallet', typeface: 'Inter Tight + Inter' },
  { code: '1b', name: 'Certificate', specimen: 'type-specimen--b', treatment: 'certificate', typeface: 'Geist throughout' },
  { code: '1c', name: 'Ingot', specimen: 'type-specimen--c', treatment: 'ingot', typeface: 'General Sans throughout' },
];

/** A slider that starts at one of the sheet's stops and is live from there. */
function SliderCase({ from }: { from: number }) {
  const [value, setValue] = useState(from);
  return <AmountSlider onChange={setValue} value={value} />;
}

const RISING: IndexPoint[] = [
  { period: '2024-10', value: 0.12 },
  { period: '2024-11', value: 0.21 },
  { period: '2024-12', value: 0.34 },
  { period: '2025-01', value: 0.4 },
  { period: '2025-02', value: 0.58 },
  { period: '2025-03', value: 0.71 },
  { period: '2025-04', value: 0.9 },
  { period: '2025-05', value: 1.05 },
  { period: '2025-06', value: 1.28 },
  { period: '2025-07', value: 1.4 },
  { period: '2025-08', value: 1.62 },
  { period: '2025-09', value: 1.71 },
  { period: '2025-10', value: 1.83 },
  { period: '2025-11', value: 1.79 },
  { period: '2025-12', value: 1.94 },
  { period: '2026-01', value: 2.05 },
  { period: '2026-02', value: 2.18 },
  { period: '2026-03', value: 2.24 },
  { period: '2026-04', value: 2.35 },
  { period: '2026-05', value: 2.41 },
  { period: '2026-06', value: 2.29 },
  { period: '2026-07', value: 2.36 },
  { period: '2026-08', value: 2.44 },
  { period: '2026-09', value: 2.52 },
];

const FLAT: IndexPoint[] = RISING.map((point, index) => ({
  period: point.period,
  value: 1.05 + Math.sin(index / 3) * 0.06,
}));

const NEGATIVE: IndexPoint[] = RISING.map((point, index) => ({
  period: point.period,
  value: -1.5 + index * 0.035,
}));

const GAPPED: IndexPoint[] = RISING.map((point, index) =>
  index === 11 || index === 12 ? { period: point.period, value: null } : point,
);

const SMALL_FLAT = FLAT.slice(-12);
const SMALL_RISING = RISING.slice(0, 12);
const SMALL_TRIGGERED = RISING.slice(-12);

export function Gallery() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [failureOpen, setFailureOpen] = useState(false);
  const [counting, setCounting] = useState(false);
  const [countingReduced, setCountingReduced] = useState(false);
  const [slider, setSlider] = useState(5500);
  const [checked, setChecked] = useState(false);
  const [history, setHistory] = useState('opened');
  const [tab, setTab] = useState<'cover' | 'index'>('cover');

  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 pb-16 sm:px-16">
      <header className="flex flex-col gap-3 py-10">
        <h1 className="text-headline font-display font-semibold tracking-headline text-ink">
          Component gallery
        </h1>
        <p className="text-body text-ink-2">
          Every component in the token sheet, in every state. Nothing here is a product screen and
          nothing here is linked from the app.
        </p>
      </header>

      <Section id="tokens" title="Colour tokens">
        <p className="text-secondary text-ink-2">
          Each token with its computed WCAG 2.x contrast ratio against canvas and against surface.
          The sheet declares a floor of 4.5 to 1. Three tokens do not clear it, which is why the
          state colours are indicators and never text, and why axis labels and the inactive tab
          label are ink-2.
        </p>
        <ul className="grid gap-4 sm:grid-cols-3">
          {COLOUR_TOKENS.map((token) => {
            const onCanvas = contrastRatio(token.hex, CANVAS);
            const onSurface = contrastRatio(token.hex, SURFACE);
            return (
              <li
                className="flex flex-col gap-2 rounded-group border border-hairline p-4"
                key={token.name}
              >
                <span
                  aria-hidden="true"
                  className="h-10 w-full rounded-field border border-hairline"
                  style={{ backgroundColor: token.hex }}
                />
                <span className="text-body font-medium text-ink">{token.name}</span>
                <span className="text-caption tabular-nums text-ink-2">{token.hex}</span>
                <span className="text-caption tabular-nums text-ink">
                  on canvas {formatRatio(onCanvas)}
                  {token.foreground && !passesTextFloor(onCanvas) ? ' (below the text floor)' : ''}
                </span>
                <span className="text-caption tabular-nums text-ink">
                  on surface {formatRatio(onSurface)}
                  {token.foreground && !passesTextFloor(onSurface) ? ' (below the text floor)' : ''}
                </span>
                <span className="text-caption text-ink-2">{token.use}</span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="pill-button" title="Pill button">
        <Grid>
          <Case label="Primary">
            <PillButton>Pay 28.00</PillButton>
          </Case>
          <Case label="Secondary">
            <PillButton variant="secondary">I want to invest</PillButton>
          </Case>
          <Case label="Disabled">
            <PillButton disabled>Submit claim</PillButton>
          </Case>
          <Case label="Loading, six pulsing dots, width unchanged">
            <PillButton loading>Pay 28.00</PillButton>
          </Case>
          <Case label="Focus">
            <PillButton className="focus-demo">Pay 28.00</PillButton>
          </Case>
          <Case label="Default and loading side by side, same width">
            <div className="flex flex-col gap-2">
              <PillButton>Pay 28.00</PillButton>
              <PillButton loading>Pay 28.00</PillButton>
            </div>
          </Case>
        </Grid>
      </Section>

      <Section id="text-link" title="Text link">
        <Grid>
          <Case label="Default">
            <span>
              <TextLink href="#text-link">How the index works</TextLink>
            </span>
          </Case>
          <Case label="Focus">
            <span>
              <TextLink className="focus-demo" href="#text-link">
                How the index works
              </TextLink>
            </span>
          </Case>
          <Case label="Hit area, 44px, drawn for the review">
            <span>
              <TextLink href="#text-link" showHitArea>
                How the index works
              </TextLink>
            </span>
          </Case>
        </Grid>
      </Section>

      <Section id="list-row" title="List row">
        <Grid>
          <Case label="Label and value, 52px">
            <SurfaceGroup>
              <ListRow label="Next payment" value="28.00 on 4 October" />
            </SurfaceGroup>
          </Case>
          <Case label="With a chevron">
            <SurfaceGroup>
              <ListRow label="Index" onSelect={() => undefined} trailing="chevron" value="1.10, steady" />
            </SurfaceGroup>
          </Case>
          <Case label="With a check">
            <SurfaceGroup>
              <ListRow label="termination-letter.pdf" trailing="check" />
            </SurfaceGroup>
          </Case>
          <Case label="Two lines, 72px">
            <SurfaceGroup>
              <ListRow
                caption="This cover has never paid for this occupation since 2010."
                label="Farming, fishing and forestry"
                trailing="chevron"
              />
            </SurfaceGroup>
          </Case>
        </Grid>
      </Section>

      <Section id="surface-group" title="Surface group">
        <Grid>
          <Case label="Two rows, separators inset 16">
            <SurfaceGroup>
              <ListRow label="Cover" value={formatAmount(5000)} />
              <ListRow label="Occupation" value="Computer and mathematical" />
            </SurfaceGroup>
          </Case>
          <Case label="Five rows">
            <SurfaceGroup>
              <ListRow label="Cover" value={formatAmount(5000)} />
              <ListRow label="Occupation" value="Computer and mathematical" />
              <ListRow label="Monthly payment" value={formatMoney(28_000_000n)} />
              <ListRow label="First payment today" value={formatMoney(28_000_000n)} />
              <ListRow label="Pays from" value={shortenAddress(DEMO_ACCOUNT.evmAddress)} />
            </SurfaceGroup>
          </Case>
        </Grid>
      </Section>

      <Section id="bottom-sheet" title="Bottom sheet">
        <Grid>
          <Case label="Closed, then opened over the frame">
            <div className="relative h-[420px] overflow-hidden rounded-card border border-hairline">
              <div className="px-5 py-6">
                <p className="text-body text-ink-2">The screen behind the sheet.</p>
                <div className="mt-4">
                  <PillButton onClick={() => setSheetOpen(true)}>Confirm your cover</PillButton>
                </div>
              </div>
              <BottomSheet inline onClose={() => setSheetOpen(false)} open={sheetOpen} title="Confirm your cover">
                <SurfaceGroup>
                  <ListRow label="Cover" value={formatAmount(5000)} />
                  <ListRow label="Occupation" value="Computer and mathematical" />
                  <ListRow label="Monthly payment" value={formatMoney(28_000_000n)} />
                  <ListRow label="Pays from" value={shortenAddress(DEMO_ACCOUNT.evmAddress)} />
                </SurfaceGroup>
                <p className="mt-2 text-secondary text-ink-2">{DEMO_WALLET_LABEL}</p>
                <div className="mt-4">
                  <PillButton onClick={() => setSheetOpen(false)}>Pay 28.00</PillButton>
                </div>
              </BottomSheet>
            </div>
          </Case>
          <Case label="Grabber 36 by 4 and the scrim at rgba(0,0,0,0.32)">
            <div className="flex flex-col gap-4">
              <span aria-hidden="true" className="h-1 w-9 rounded-full bg-hairline" />
              <span
                aria-hidden="true"
                className="h-16 w-full rounded-field"
                style={{ backgroundColor: 'rgba(0,0,0,0.32)' }}
              />
            </div>
          </Case>
        </Grid>
      </Section>

      <Section id="display-number" title="Display number">
        <Grid>
          <Case label="display-xl">
            <DisplayNumber value={5000} />
          </Case>
          <Case label="display-l">
            <DisplayNumber size="display-l" value={2500} />
          </Case>
          <Case label="Negative, U+002D">
            <DisplayNumber size="display-l" value={-7500} />
          </Case>
          <Case label="Count-up, 600ms, the one orchestrated moment">
            <div className="flex flex-col gap-3">
              <DisplayNumber countUp={counting} value={5000} />
              <PillButton onClick={() => setCounting((was) => !was)} variant="secondary">
                {counting ? 'Reset' : 'Count up'}
              </PillButton>
            </div>
          </Case>
          <Case label="Count-up with reduced motion forced, lands in one frame">
            <div className="flex flex-col gap-3">
              <DisplayNumber countUp={countingReduced} forceReducedMotion value={5000} />
              <PillButton onClick={() => setCountingReduced((was) => !was)} variant="secondary">
                {countingReduced ? 'Reset' : 'Count up'}
              </PillButton>
            </div>
          </Case>
        </Grid>
      </Section>

      <Section id="amount-slider" title="Amount slider">
        <Grid>
          <Case label="At 1,000">
            <SliderCase from={1000} />
          </Case>
          <Case label="At 5,500">
            <SliderCase from={5500} />
          </Case>
          <Case label="At 10,000">
            <SliderCase from={10_000} />
          </Case>
          <Case label="Interactive, keyboard focus with the arrow keys">
            <div className="flex flex-col gap-3">
              <AmountSlider onChange={setSlider} value={slider} />
              <DisplayNumber size="display-l" value={slider} />
            </div>
          </Case>
        </Grid>
      </Section>

      <Section id="status-pill" title="Status pill">
        <div className="flex flex-wrap items-center gap-4">
          <StatusPill state="covered">Covered</StatusPill>
          <StatusPill state="watch">Claims open</StatusPill>
          <StatusPill state="triggered">Paid out</StatusPill>
          <StatusPill state="none">Cover ended</StatusPill>
        </div>
        <p className="text-secondary text-ink-2">
          The dot is the state colour and the label is ink. No state colour is used as the colour of
          a string a person has to read.
        </p>
      </Section>

      <Section id="tab-bar" title="Tab bar">
        <Grid>
          <Case label="Cover active">
            <div className="w-full max-w-[390px] border border-hairline">
              <TabBar active="cover" />
            </div>
          </Case>
          <Case label="Index active">
            <div className="w-full max-w-[390px] border border-hairline">
              <TabBar active="index" />
            </div>
          </Case>
          <Case label="Interactive">
            <div className="w-full max-w-[390px] border border-hairline">
              <TabBar active={tab} onSelect={setTab} />
            </div>
          </Case>
        </Grid>
      </Section>

      <Section id="toast" title="Toast and failure sheet">
        <Grid>
          <Case label="Toast, offline">
            <Toast>{OFFLINE.title}</Toast>
          </Case>
          <Case label="Toast, payment failed">
            <Toast>{PAYMENT_FAILED.title}</Toast>
          </Case>
          <Case label="Failure sheet, payment failed">
            <div className="relative h-[360px] overflow-hidden rounded-card border border-hairline">
              <div className="px-5 py-6">
                <PillButton onClick={() => setFailureOpen(true)} variant="secondary">
                  Show the sheet
                </PillButton>
              </div>
              <BottomSheet
                inline
                onClose={() => setFailureOpen(false)}
                open={failureOpen}
                title={PAYMENT_FAILED.title}
              >
                <FailureBody
                  action={PAYMENT_FAILED.action}
                  body={PAYMENT_FAILED.body}
                  onAction={() => setFailureOpen(false)}
                />
              </BottomSheet>
            </div>
          </Case>
          <Case label="Failure body, offline">
            <FailureBody action={OFFLINE.action} body={OFFLINE.body} title={OFFLINE.title} />
          </Case>
        </Grid>
      </Section>

      <Section id="form-field" title="Form field">
        <Grid>
          <Case label="Empty">
            <FormField label="Employer" placeholder="Who you worked for" />
          </Case>
          <Case label="Filled">
            <FormField defaultValue="Northgate Logistics" label="Employer" />
          </Case>
          <Case label="Focus">
            <FormField className="focus-demo" defaultValue="Northgate Logistics" label="Employer" />
          </Case>
          <Case label="Inline error, on canvas, outside the surface fill">
            <FormField
              defaultValue="I resigned"
              error="Cover doesn't pay for this. You can still submit and a person will look at it."
              label="How did it end?"
            />
          </Case>
        </Grid>
      </Section>

      <Section id="table" title="Table row">
        <Case label="Header, body rows, numeric columns right aligned and tabular">
          <DataTable
            caption="Coupon history"
            columns={[
              { key: 'month', label: 'Month' },
              { key: 'state', label: 'State' },
              { key: 'amount', label: 'Amount', numeric: true },
              { key: 'reading', label: 'Reading', numeric: true },
            ]}
            rows={[
              {
                key: '2026-04',
                cells: ['April 2026', 'Paid', formatMoney(1_666_000_000n), '2.35'],
              },
              {
                key: '2026-05',
                cells: ['May 2026', 'Paid', formatMoney(1_666_000_000n), '2.41'],
              },
              {
                key: '2026-06',
                cells: ['June 2026', 'Paid', formatMoney(1_666_000_000n), '2.29'],
              },
            ]}
          />
        </Case>
      </Section>

      <Section id="index-chart-small" title="Index line, small">
        <p className="text-secondary text-ink-2">
          64 by 20, no band unless the state is triggered, no axis labels, 1.25px line.
        </p>
        <Grid>
          <Case label="Flat">
            <IndexChart label="Legal" points={SMALL_FLAT} size="small" state="flat" threshold={2} />
          </Case>
          <Case label="Rising">
            <IndexChart
              label="Computer and mathematical"
              points={SMALL_RISING}
              size="small"
              state="rising"
              threshold={2}
            />
          </Case>
          <Case label="Triggered, the line enters the band">
            <IndexChart
              label="Computer and mathematical"
              points={SMALL_TRIGGERED}
              size="small"
              state="triggered"
              threshold={2}
            />
          </Case>
        </Grid>
      </Section>

      <Section id="index-chart-large" title="Index line, large">
        <p className="text-secondary text-ink-2">
          24 months, 180px on a phone and 300px on the web, 1.5px line, two axis labels in ink-2 and
          the band label between them.
        </p>
        <div className="grid gap-10 sm:grid-cols-2">
          <Case label="Positive line with a positive band, triggered">
            <IndexChart
              label="Computer and mathematical"
              points={RISING}
              showTable
              state="triggered"
              threshold={2}
            />
          </Case>
          <Case label="Negative line with a negative band, no clamp at zero">
            <IndexChart
              label="Farming, fishing and forestry"
              points={NEGATIVE}
              state="rising"
              threshold={-0.9}
            />
          </Case>
          <Case label="Band above the whole range">
            <IndexChart label="Legal" points={FLAT} state="flat" threshold={4} />
          </Case>
          <Case label="A missing month, two paths and no bridge">
            <IndexChart
              label="Computer and mathematical"
              points={GAPPED}
              state="rising"
              threshold={2}
            />
          </Case>
          <Case label="At 300px, the web height">
            <IndexChart
              height={300}
              label="Computer and mathematical"
              points={RISING}
              state="triggered"
              threshold={2}
              width={640}
            />
          </Case>
        </div>
      </Section>

      <Section id="cover-card" title="Cover card">
        <Grid>
          <Case label="Default gradient, 20px radius, display-l amount">
            <CoverCard
              amount={formatAmount(5000)}
              className="h-[220px] w-full max-w-[350px]"
              occupation="Computer and mathematical"
              state="covered"
              statusLabel="Covered"
            />
          </Case>
          <Case label="Hero gradient with the brushing, 32px radius">
            <CoverCard
              amount={formatAmount(5000)}
              className="h-[320px] w-full max-w-[520px]"
              hero
              occupation="Computer and mathematical"
              state="covered"
              statusLabel="Covered"
            />
          </Case>
          <Case label="Long occupation label at the 190px cap">
            <CoverCard
              amount={formatAmount(10_000)}
              className="h-[220px] w-full max-w-[350px]"
              occupation="Arts, design, entertainment and media"
              state="watch"
              statusLabel="Claims open"
            />
          </Case>
        </Grid>
      </Section>

      <Section id="home-directions" title="Home card, three directions">
        <p className="text-secondary text-ink-2">
          Each direction changes the card treatment and the typeface together and nothing else.
          NEXT_PUBLIC_FONT_OPTION picks the pair the product builds, A by default, and all three
          are the same component with the same copy in it.
        </p>
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-3 lg:gap-6">
          {HOME_DIRECTIONS.map((direction) => (
            <div
              className="flex w-full max-w-[390px] flex-col gap-4"
              key={direction.code}
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded-full bg-ink px-3 py-1 text-caption font-semibold text-white">
                  {direction.code}
                </span>
                <span className="text-body font-semibold text-ink">{direction.name}</span>
                <span className="text-caption text-ink-2">{direction.typeface}</span>
              </div>
              <div className={`type-specimen ${direction.specimen}`}>
                <CoverCard
                  amount={formatAmount(5000)}
                  className="h-[210px] w-full"
                  occupation="Office and administrative support"
                  state="covered"
                  statusLabel="Covered"
                  treatment={direction.treatment}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="upload" title="Upload area and file rows">
        <Grid>
          <Case label="Empty">
            <UploadArea />
          </Case>
          <Case label="One file">
            <UploadArea files={[{ name: 'termination-letter.pdf', bytes: 240_000 }]} />
          </Case>
          <Case label="Three files, one over a megabyte, one failed">
            <UploadArea
              files={[
                { name: 'termination-letter.pdf', bytes: 240_000 },
                { name: 'final-pay-statement-september-2026-scan.pdf', bytes: 3_400_000 },
                { name: 'p45.jpg', bytes: 900_000, failed: true },
              ]}
            />
          </Case>
        </Grid>
      </Section>

      <Section id="checkbox" title="Checkbox row">
        <Grid>
          <Case label="Unchecked">
            <CheckboxRow checked={false}>
              Everything here is true. I understand that a false claim is fraud.
            </CheckboxRow>
          </Case>
          <Case label="Checked">
            <CheckboxRow checked>
              Everything here is true. I understand that a false claim is fraud.
            </CheckboxRow>
          </Case>
          <Case label="Interactive, focus with the tab key">
            <CheckboxRow checked={checked} onChange={setChecked}>
              Everything here is true. I understand that a false claim is fraud.
            </CheckboxRow>
          </Case>
        </Grid>
      </Section>

      <Section id="segmented" title="Segmented toggle">
        <Grid>
          <Case label="Three options, arrow keys move between them">
            <SegmentedToggle
              active={history}
              label="Which months to show"
              onSelect={setHistory}
              options={[
                { id: 'opened', label: 'Opened' },
                { id: 'all', label: 'All' },
                { id: 'revised', label: 'Revised' },
              ]}
            />
          </Case>
          <Case label="Each option active">
            <div className="flex flex-col gap-3">
              {['opened', 'all', 'revised'].map((id) => (
                <SegmentedToggle
                  active={id}
                  key={id}
                  label={`Which months to show, ${id} active`}
                  options={[
                    { id: 'opened', label: 'Opened' },
                    { id: 'all', label: 'All' },
                    { id: 'revised', label: 'Revised' },
                  ]}
                />
              ))}
            </div>
          </Case>
        </Grid>
      </Section>

      <Section id="copy" title="Copy button">
        <Case label="Beside a value, swaps to a check for 1200ms">
          <span className="inline-flex items-center gap-2 text-body tabular-nums text-ink">
            {shortenAddress(DEMO_ACCOUNT.evmAddress)}
            <CopyButton value={DEMO_ACCOUNT.evmAddress} what="address" />
          </span>
        </Case>
      </Section>

      <Section id="skeleton" title="Skeleton">
        <p className="text-secondary text-ink-2">
          Surface at the field radius, the exact final dimensions, and no shimmer. Nothing else on
          this screen moves, so a pulsing placeholder would be the only motion on the page.
        </p>
        <Grid>
          <Case label="Rows">
            <div aria-busy="true" className="flex flex-col gap-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          </Case>
          <Case label="Figure and chart box">
            <div aria-busy="true" className="flex flex-col gap-4">
              <SkeletonFigure />
              <SkeletonChart />
              <Skeleton className="h-5 w-16" />
            </div>
          </Case>
        </Grid>
      </Section>

      <Section id="replay" title="Replay bar">
        <Grid>
          <Case label="Compact, in an app header">
            <ReplayBar label="Replay: Jul 2026" variant="compact" />
          </Case>
          <Case label="Full, sticky at the top of a public page">
            <ReplayBar
              detail="Months are replayed at ten seconds each."
              label="Replay: Jul 2026"
            />
          </Case>
        </Grid>
      </Section>

      <Section id="wallet" title="Wallet">
        <p className="text-secondary text-ink-2">
          The worker flow shows the wallet exactly once, in the Pay sheet, as the Pays from row.
          No network name, no gas, no transaction hash. The demo mode is labelled wherever it
          shows.
        </p>
        <div className="max-w-[390px]">
          <SurfaceGroup>
            <ListRow label="Pays from" value={shortenAddress(DEMO_ACCOUNT.evmAddress)} />
          </SurfaceGroup>
          <p className="mt-2 text-secondary text-ink-2">{DEMO_WALLET_LABEL}</p>
        </div>
      </Section>

      <Section id="frame" title="Desktop frame">
        <p className="text-secondary text-ink-2">
          The tab bar is a mobile pattern. On a wide viewport the 390 column stays a column: it
          stands on the surface ground under the product&apos;s header, as a canvas sheet with
          hairline sides. The desktop pages stand on continuous canvas under the same header.
        </p>
        <AppFrame>
          <div className="flex flex-col gap-6 px-5 py-8">
            <CoverCard
              amount={formatAmount(5000)}
              className="h-[200px]"
              occupation="Computer and mathematical"
              state="covered"
              statusLabel="Covered"
            />
            <SurfaceGroup>
              <ListRow label="Next payment" value="28.00 on 4 October" />
              <ListRow label="Index" trailing="chevron" value="1.10, steady" />
            </SurfaceGroup>
            <TabBar active="cover" />
          </div>
        </AppFrame>
      </Section>
    </main>
  );
}
