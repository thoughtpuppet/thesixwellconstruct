# Search Console release checklist

This checklist begins only after the SEO implementation is separately approved, committed, pushed, and deployed. It does not authorize DNS or Search Console changes.

## Release gate

- Confirm the deployed commit matches the approved local diff.
- Verify `https://thesixwellconstruct.com/robots.txt` returns 200 and names the absolute sitemap URL.
- Verify `https://thesixwellconstruct.com/sitemap.xml` returns 200 XML and contains only public, canonical, indexable 200-status URLs.
- Check representative HTML source for one title, description, canonical, robots policy, meaningful H1, crawlable links, and parseable JSON-LD.
- Confirm private candidates, Studio routes, forms, tokens, confirmation pages, drafts, individual tattoo modal states, telephone, coordinates, and regular opening hours are absent.

## Property setup (separate authorization required)

1. Add the Domain property `thesixwellconstruct.com`. Google documents that a Domain property covers protocols and subdomains and requires DNS verification: [Add a property](https://support.google.com/webmasters/answer/34592?hl=en).
2. Add the exact DNS TXT/CNAME token Google supplies. Keep it after verification so ownership remains valid: [Verify site ownership](https://support.google.com/webmasters/answer/9008080?hl=en).
3. Give each person the least privilege they need; owners can manage users and verification: [Users and permissions](https://support.google.com/webmasters/answer/7687615?hl=en).
4. Submit `https://thesixwellconstruct.com/sitemap.xml`. Google notes that submission can speed discovery and enables sitemap monitoring: [Get started with Search Console](https://developers.google.com/search/docs/monitor-debug/search-console-start).

## Representative URL inspection

- `/about/saieldauhnsolehman/`
- `/tattoos/`
- `/tattoos/portfolio/`
- `/tattoos/flash/`
- `/tattoos/inquire/`
- `/tattoos/location-parking/`
- `/merch/` and one public available product
- `/events/` and one public Six.Well-produced event
- `/calendar/` and one approved curated event
- `/archive/` and one public record
- `/writings/` and one public writing

Use URL Inspection to compare index status and the live page; Google describes it as the tool for the indexed version, live testing, resource details, and crawl requests: [Search Console basics](https://developers.google.com/search/docs/monitor-debug/search-console-start).

## Reporting definitions

| Journey | Search Console segment | On-site outcome |
| --- | --- | --- |
| Branded Saiel | Queries containing `Saiel Dauhn Solehman`, `Saiel Solehman`, and confirmed spelling variants | Person-page entries; onward visits to work and opportunity paths |
| Tattoo discovery | Non-branded queries landing under `/tattoos/` | Completed tattoo inquiry (`form_complete`) |
| Clothing discovery | Queries landing under `/merch/` or canonical product routes | Product detail visit, add-to-cart, checkout/purchase when public commerce emits it |
| Produced events | Queries landing under `/events/` | Event detail visit, registration/ticket action |
| Atlanta Creative Calendar | Queries landing under `/calendar/` | Approved event detail visit, source/ticket click, calendar action |

Record impressions, clicks, CTR, average position, landing page, device, and country. Compare 28-day and 90-day windows; annotate releases and major public-record changes. Rankings are observations, not promised outcomes.
