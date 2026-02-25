import { PageMeta } from "@/components/page-meta";
import { Building2, Shield, Zap, BarChart3, MapPin, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function About() {
  return (
    <div className="p-6 max-w-4xl mx-auto" data-testid="page-about">
      <PageMeta
        title="About"
        description="About RoofIntel — a data-driven intelligence platform built for commercial roofing contractors. Discover how we use public data to identify high-quality roofing leads."
        path="/about"
      />
      <h1 className="text-3xl font-bold mb-2" data-testid="heading-about">About RoofIntel</h1>
      <p className="text-muted-foreground mb-8">Data-driven intelligence for commercial roofing contractors</p>

      <div className="space-y-8 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-xl font-semibold mb-3">Our Mission</h2>
          <p>RoofIntel helps commercial roofing contractors identify and prioritize their best opportunities using objective, public data. Instead of cold-calling from generic lists, contractors can focus on properties with the highest likelihood of needing roof work — based on actual roof age, documented hail exposure, and verified property characteristics.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">What We Do</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card data-testid="card-feature-data">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Property Intelligence</h3>
                </div>
                <p className="text-muted-foreground">Aggregate commercial property data from 4 DFW county appraisal districts — Dallas, Tarrant, Collin, and Denton — covering the entire metro area.</p>
              </CardContent>
            </Card>
            <Card data-testid="card-feature-hail">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Hail Exposure Analysis</h3>
                </div>
                <p className="text-muted-foreground">Match NOAA historical hail events and real-time SWDI radar data to individual properties, with proximity-based scoring and storm recency weighting.</p>
              </CardContent>
            </Card>
            <Card data-testid="card-feature-scoring">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Lead Scoring</h3>
                </div>
                <p className="text-muted-foreground">A refined 0-100 scoring algorithm incorporating roof age, hail exposure, storm recency, roof area, contactability, owner type, property value, and distress signals.</p>
              </CardContent>
            </Card>
            <Card data-testid="card-feature-owners">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-2">
                  <Users className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Owner Intelligence</h3>
                </div>
                <p className="text-muted-foreground">A 16-agent system that identifies property owners, resolves LLC chains, discovers portfolios, and finds decision-makers using only public records.</p>
              </CardContent>
            </Card>
            <Card data-testid="card-feature-storms">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-2">
                  <Zap className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Storm Monitoring</h3>
                </div>
                <p className="text-muted-foreground">Real-time NOAA SWDI hail radar monitoring and Xweather predictive hail threat forecasting with pre-storm alerting.</p>
              </CardContent>
            </Card>
            <Card data-testid="card-feature-compliance">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Compliance Built In</h3>
                </div>
                <p className="text-muted-foreground">Opt-out management, DNC list checking, consent tracking, source policy enforcement, and robots.txt compliance across all data collection.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Data Integrity</h2>
          <p>Every data point in RoofIntel comes from a verifiable public source. We never use mock data, synthetic leads, or fabricated contact information. All sources carry trust scores (e.g., DCAD: 95, TX Comptroller: 92) and evidence is recorded with corroboration counting and conflict detection.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">Coverage Area</h2>
          <p>RoofIntel currently covers the Dallas-Fort Worth metropolitan area across four counties: Dallas (DCAD), Tarrant (TAD), Collin (Collin CAD), and Denton (Denton CAD). The platform is built with a multi-market architecture for future expansion to additional metro areas.</p>
        </section>
      </div>
    </div>
  );
}
