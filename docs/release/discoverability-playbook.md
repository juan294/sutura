# Discoverability playbook

Plan: `docs/plans/2026-09-05-sutura-discoverability.md`. All accounts belong to `juan294@gmail.com`. Every identifier below is public: it is served in the HTML of every Case Lab page or is visible in a public listing. Secrets never belong in this file.

## Registered properties

| Service | Entry | Identifier | Created | Status |
| --- | --- | --- | --- | --- |
| Google Analytics 4 | Property "Sutura Case Lab" under account "Spoken Letter" (398659195); web stream "Sutura Case Lab", stream 15723700890 | Measurement ID `G-Z65T5Y173D` | 2026-09-05 | Created; time zone Spain, currency USD, enhanced measurement on, Google Signals off |
| Microsoft Clarity | Project "Sutura Case Lab", industry Technology & Telecommunications | Project ID `ydi0lx4kw6` | 2026-09-05 | Created; not linked to GA4 |
| Google Search Console | URL-prefix property `https://sutura-case-lab.vercel.app/` | HTML tag `f7PZNffeQUHV6bvX9Pzff2dL0yT9iyxDqT83uHy3Dfg` | 2026-09-05 | Property added; verification pending the Phase 2 deploy |
| Bing Webmaster Tools | Site `https://sutura-case-lab.vercel.app/`, added manually | Meta tag `msvalidate.01` = `9E58012EFDC70E5C8289C62F90BD646F` | 2026-09-05 | Site added, shown as "Not verified" pending the Phase 2 deploy |
| Vercel Web Analytics | Project `sutura-case-lab`, team The Creative Token (Pro), included tier | none (script at `/_vercel/insights/script.js`) | 2026-09-05 | Enabled; dashboard shows 0 visitors until the script ships |
| GitHub repository | `juan294/sutura` | homepage `https://sutura-case-lab.vercel.app`, 12 topics, social preview uploaded from `packages/case-lab/assets/social-card.png` | 2026-09-05 | Done |

A separate Google Analytics account named "Sutura" was not created: a new account requires accepting the Google Analytics Terms of Service, which is Juan's click. The property can be moved to a new account later from Admin → Property → Move.

The verification tokens, measurement ID, and Clarity ID are the values in `packages/case-lab/site.json`. Changing that file changes every served page on the next prebuilt deploy.

## Deploy procedure

Only prebuilt deploys, never a Git-triggered build:

```bash
cd packages/case-lab
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
curl -sS https://sutura-case-lab.vercel.app/ | grep -E "google-site-verification|msvalidate.01|G-Z65T5Y173D|clarity"
```

## Live checks

```bash
curl -sS https://sutura-case-lab.vercel.app/robots.txt
curl -sS https://sutura-case-lab.vercel.app/sitemap.xml
curl -sSI https://sutura-case-lab.vercel.app/result/ | grep -i x-robots-tag
node packages/case-lab/bin/case-lab.js acceptance --base-url https://sutura-case-lab.vercel.app
```

## Verification and submission log

| Date | Action | Result |
| --- | --- | --- |
| 2026-09-05 | Phase 3A: properties created, identifiers collected (table above) | Done |

## Monitoring cadence

Weekly until 2026-10-30, then monthly. Record each pass as one dated entry
under this section: date, the four counts below, and any action taken.

| Tool | What to read | What to record |
| --- | --- | --- |
| Google Search Console (`https://sutura-case-lab.vercel.app/` URL-prefix property) | Pages report: indexed count, which should reach 8 (`/`, five `/replay/<case>/`, `/about/`, `/privacy/`). Performance report: queries, impressions, clicks. Core Web Vitals report: any page marked poor or needs improvement. | Indexed count, top three queries with impressions, any CWV issue and the affected URL. |
| Bing Webmaster Tools | Site Explorer: indexed count. Crawl errors and the URL Inspection state of `/` and `/about/`. | Indexed count, every crawl error with its URL. |
| Google Analytics 4 | Users, top pages, and referrers for the period. Note the Devpost and GitHub referral share. | Users, top three pages, the Devpost and GitHub share of sessions. |
| Microsoft Clarity | Rage clicks and dead clicks on the case cards and the live-run button. | Count of each, with the element, and whether the live-run gate was on. |

Action rule: any page that Search Console lists as "Excluded" or "Crawled,
currently not indexed" gets one URL Inspection re-request in the same pass.
If the page is still not indexed at the next pass, open an issue that names
the URL and the status; do not re-request a second time without a content or
markup change.

### Entries

| Date | Google indexed | Bing indexed | GA4 users | Clarity rage / dead clicks | Action |
| --- | ---: | ---: | ---: | --- | --- |
