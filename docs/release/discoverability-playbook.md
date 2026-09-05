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
