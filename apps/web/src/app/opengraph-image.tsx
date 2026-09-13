import { ImageResponse } from 'next/og';

/**
 * The link preview (T53): the landing hero, redrawn.
 *
 * A shared link unfurls as a title, a description and this image, and the
 * product already has the best possible one, the metal card. It is generated
 * here rather than exported by hand so that it cannot drift from the card,
 * but it is a redrawing and not a render of CoverCard: next/og draws through
 * Satori, which has flexbox, gradients and shadows and none of the custom
 * properties, pseudo elements, blend modes or animation the stylesheet's
 * `.cover-card` rules use. Every colour and stop below is the sheet's own
 * (docs/DESIGN-TOKENS.md section 4, the addendum's "The metal"), and the
 * shimmer stands at the centre of the card, which is where the stylesheet
 * puts it for a still frame and a reduced motion reader.
 *
 * Static, by design. An unfurl is a page view a bot makes many times, and the
 * landing figures come from paid reads behind a hold, so nothing here reads
 * the feed or the from price. The words are the hero's own from the copy
 * deck; the card carries the cover the hero card shows at rest, which is a
 * cover amount and not a price. docs/DECISIONS.md, T53.
 *
 * Because it is a redrawing it can fall behind the card, and it had. The
 * shimmer here was the narrow band with a white core that T52 tried and Root
 * rejected by name, months after the stylesheet had gone back to T34's wide
 * soft wash, so the preview was showing a finish the product does not have.
 * The edge was the plain hairline rather than the metal modifier's cooler
 * grey, and the hero's inner edge light was missing altogether. Every light
 * layer below is now the rule it redraws, stop for stop: `.cover-card`,
 * `.cover-card--hero::after`, `.cover-card--metal` and
 * `.cover-card__shimmer::before` in the global stylesheet. Anything changed
 * there has to be changed here, and the way to check is to put this image
 * beside a screenshot of the live hero card under reduced motion, which is the
 * state this frame draws.
 *
 * The lead line that stood under the headline is gone. It was 27px of 66
 * percent white, which holds on a link unfurl at 500 wide and disappears in a
 * submission gallery that renders the same file as a thumbnail. The headline
 * carries the image on its own.
 *
 * Fonts. Satori needs font bytes and the next/font cache holds woff2, which it
 * cannot read, so the two families of option A are fetched from Google Fonts
 * as TrueType when this route is built, subset to the characters drawn. That
 * is the same network the build already needs for next/font/google. Should a
 * fetch fail the image is still produced in the renderer's own face rather
 * than failing the build, so a preview is never a broken image.
 *
 * Legibility: a preview renders at about 500 pixels wide, so everything is
 * at headline scale. Nothing below 26px on the ground and nothing below 18px
 * on the card.
 */

export const alt = 'Creance. Cover for the day your job is automated.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const MARK = 'Creance';
const HEADLINE = 'Cover for the day your job is automated.';
const OCCUPATION = 'Computer and mathematical';
const STATUS = 'Covered';
const CAPTION = 'Cover';
const AMOUNT = '5,000';

type Weight = 400 | 500 | 600;

/**
 * One weight of one family from Google Fonts, as TrueType, subset to `text`.
 * A plain fetch with no browser user agent is answered with a truetype source,
 * which is the format Satori parses fastest.
 */
async function googleFont(
  family: string,
  weight: Weight,
  text: string,
): Promise<{ name: string; data: ArrayBuffer; weight: Weight; style: 'normal' } | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`,
      { cache: 'force-cache' },
    ).then((response) => response.text());
    const source = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css);
    if (source?.[1] === undefined) return null;
    const file = await fetch(source[1], { cache: 'force-cache' });
    if (!file.ok) return null;
    return { name: family, data: await file.arrayBuffer(), weight, style: 'normal' };
  } catch {
    return null;
  }
}

const NIGHT = '#0a0d12';
const INK = '#000000';
/** `.cover-card--metal`: the cooler grey a milled edge catches. */
const EDGE = '#cfd4dc';
const HAIRLINE = '#e4e6ea';
const COVERED = '#0b8a4e';

/** docs/DESIGN-TOKENS.md section 4, the four stop gradient. */
const METAL = 'linear-gradient(118deg, #fdfdfe 0%, #e9ebef 36%, #f7f8fa 58%, #dfe2e7 100%)';
/** The diagonal sheen, `.cover-card::before`. */
const SHEEN =
  'linear-gradient(118deg, transparent 40%, rgba(255, 255, 255, 0.85) 48%, transparent 58%)';
/** The brushing, landing size only, `.cover-card--hero::after`. */
const BRUSHING =
  'repeating-linear-gradient(118deg, rgba(255, 255, 255, 0.35) 0px, rgba(255, 255, 255, 0.35) 1px, transparent 1px, transparent 5px)';
/**
 * The reflection, `.cover-card__shimmer::before`: five pale hues at 16 percent
 * across a third of a band two and a bit cards wide. The animation stands it in
 * the centre of the face at rest, which is where a still frame sees it, so the
 * band is drawn here with no travel.
 */
const SHIMMER =
  'linear-gradient(118deg, transparent 34%, rgba(255, 122, 182, 0.16) 40%, rgba(255, 209, 122, 0.16) 45%, rgba(138, 230, 172, 0.16) 50%, rgba(122, 186, 255, 0.16) 55%, rgba(186, 148, 255, 0.16) 60%, transparent 66%)';

/** The card is drawn at two thirds, so `.cover-card--hero`'s 32px is 21 here. */
const RADIUS = 21;

const layer = {
  position: 'absolute' as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  borderRadius: RADIUS,
};

export default async function Image() {
  const fonts = (
    await Promise.all([
      googleFont('Inter Tight', 600, `${HEADLINE}${AMOUNT}`),
      googleFont('Inter', 500, `${MARK}${OCCUPATION}${STATUS}`),
      googleFont('Inter', 400, CAPTION),
    ])
  ).filter((font) => font !== null);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: NIGHT,
          color: '#ffffff',
          fontFamily: 'Inter',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            width: 560,
            height: '100%',
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 500, lineHeight: 1 }}>{MARK}</div>
          {/* 72 rather than the 64 it stood at with a lead under it. The
              headline is the only thing in this column now, and a submission
              gallery scales the whole image down to a card, so it takes the
              room the lead was using. */}
          <div
            style={{
              marginTop: 40,
              fontFamily: 'Inter Tight',
              fontSize: 72,
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: '-0.025em',
            }}
          >
            {HEADLINE}
          </div>
        </div>

        {/* The card, 720 by 432 in the design, at two thirds. The light layers
            go in the stylesheet's order, gradient, sheen, brushing, shimmer,
            and the content sits over all of them. */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            width: 480,
            height: 288,
            borderRadius: RADIUS,
            overflow: 'hidden',
            border: `1px solid ${EDGE}`,
            background: METAL,
            boxShadow: '0 40px 80px -32px rgba(0, 0, 0, 0.55)',
            color: INK,
          }}
        >
          <div style={{ ...layer, background: SHEEN }} />
          {/* The hero's ::after is one element carrying two things: the
              brushing, and a one pixel inner edge light that is what makes the
              top corners of the live card read as a milled lip. */}
          <div
            style={{
              ...layer,
              border: '1px solid rgba(255, 255, 255, 0.85)',
              background: BRUSHING,
            }}
          />
          {/* The stylesheet draws the band on a box a quarter taller and
              sixty percent wider each side than the card and lets the card
              clip it, so the band is as wide here as it is on the page. */}
          <div
            style={{
              position: 'absolute',
              top: '-25%',
              right: '-60%',
              bottom: '-25%',
              left: '-60%',
              background: SHIMMER,
            }}
          />
          <div
            style={{
              ...layer,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: 28,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.2 }}>{OCCUPATION}</div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 14px',
                  borderRadius: 999,
                  border: `1px solid ${HAIRLINE}`,
                  background: 'rgba(255, 255, 255, 0.78)',
                  fontSize: 18,
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                <div
                  style={{ width: 8, height: 8, borderRadius: 999, background: COVERED }}
                />
                {STATUS}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 20, fontWeight: 400, lineHeight: 1.2 }}>{CAPTION}</div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: 'Inter Tight',
                  fontSize: 76,
                  fontWeight: 600,
                  lineHeight: 0.95,
                  letterSpacing: '-0.02em',
                }}
              >
                {AMOUNT}
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length === 0 ? undefined : fonts },
  );
}
