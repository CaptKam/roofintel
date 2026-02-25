import { PageMeta } from "@/components/page-meta";

export default function Privacy() {
  return (
    <div className="p-6 max-w-4xl mx-auto" data-testid="page-privacy">
      <PageMeta
        title="Privacy Policy"
        description="RoofIntel privacy policy. Learn how we collect, use, and protect your data when using our commercial roofing lead intelligence platform."
        path="/privacy"
      />
      <h1 className="text-3xl font-bold mb-6" data-testid="heading-privacy">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: February 2026</p>

      <div className="space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-xl font-semibold mb-3">1. Information We Collect</h2>
          <p>RoofIntel collects and processes publicly available property data, appraisal district records, building permit information, and business entity filings. This data is sourced from government agencies and public record databases including Dallas Central Appraisal District (DCAD), Tarrant Appraisal District (TAD), Collin CAD, Denton CAD, NOAA weather data, Texas Secretary of State, Texas Comptroller, and county clerk records.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. How We Use Data</h2>
          <p>Property and owner data is used to generate commercial roofing lead intelligence, including lead scoring based on roof age, hail exposure history, and property characteristics. Contact information derived from public records is used to identify decision-makers for commercial properties.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. Data Sources</h2>
          <p>All data is sourced from publicly accessible government databases, open data portals, and public record APIs. We do not purchase data from private data brokers or scrape non-public sources. Our source policy includes robots.txt compliance, per-domain rate limiting, and blocked domain enforcement.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. Compliance</h2>
          <p>RoofIntel maintains a compliance gate system that manages opt-outs, consent tracking, and Do Not Call (DNC) list checks. Property owners and contacts may request removal of their information from our platform at any time.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. Data Security</h2>
          <p>We implement security measures including HTTPS encryption, Content Security Policy headers, rate limiting, and secure session management to protect data in transit and at rest.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. Third-Party Services</h2>
          <p>We may use third-party APIs for data enrichment on a manual, opt-in basis only. These include Google Places API, Hunter.io, and People Data Labs. Paid API usage is controlled by the user and never triggered automatically.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. Contact</h2>
          <p>For privacy inquiries, data removal requests, or questions about our data practices, please use the contact information on our <a href="/contact" className="text-primary underline" data-testid="link-contact-from-privacy">Contact page</a>.</p>
        </section>
      </div>
    </div>
  );
}
