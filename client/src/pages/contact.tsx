import { PageMeta } from "@/components/page-meta";
import { Mail, Shield, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function Contact() {
  return (
    <div className="p-6 max-w-4xl mx-auto" data-testid="page-contact">
      <PageMeta
        title="Contact"
        description="Contact the RoofIntel team for support, data removal requests, or questions about our commercial roofing lead intelligence platform."
        path="/contact"
      />
      <h1 className="text-3xl font-bold mb-2" data-testid="heading-contact">Contact Us</h1>
      <p className="text-muted-foreground mb-8">Get in touch with the RoofIntel team</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card data-testid="card-contact-support">
          <CardContent className="pt-6 text-center">
            <Mail className="h-8 w-8 text-primary mx-auto mb-3" />
            <h2 className="font-semibold mb-2">General Support</h2>
            <p className="text-sm text-muted-foreground">For platform questions, technical support, or feature requests.</p>
          </CardContent>
        </Card>
        <Card data-testid="card-contact-privacy">
          <CardContent className="pt-6 text-center">
            <Shield className="h-8 w-8 text-primary mx-auto mb-3" />
            <h2 className="font-semibold mb-2">Data Removal</h2>
            <p className="text-sm text-muted-foreground">To request removal of your property or contact information from our platform.</p>
          </CardContent>
        </Card>
        <Card data-testid="card-contact-business">
          <CardContent className="pt-6 text-center">
            <FileText className="h-8 w-8 text-primary mx-auto mb-3" />
            <h2 className="font-semibold mb-2">Business Inquiries</h2>
            <p className="text-sm text-muted-foreground">For partnership opportunities, API access, or enterprise licensing.</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 text-sm text-foreground/90">
        <p>RoofIntel is a data intelligence platform for commercial roofing contractors. All property data is sourced from public government records and appraisal district databases.</p>
        <p>For data removal requests, please include the property address and/or owner name you would like removed. Requests are processed through our compliance gate system, which manages opt-outs and consent tracking.</p>
        <p className="text-muted-foreground">
          See our <a href="/privacy" className="text-primary underline" data-testid="link-privacy-from-contact">Privacy Policy</a> for details on how we handle data.
          Learn more <a href="/about" className="text-primary underline" data-testid="link-about-from-contact">About RoofIntel</a>.
        </p>
      </div>
    </div>
  );
}
