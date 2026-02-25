import { Helmet } from "react-helmet-async";

interface PageMetaProps {
  title: string;
  description: string;
  path?: string;
}

export function PageMeta({ title, description, path = "/" }: PageMetaProps) {
  const fullTitle = `${title} | RoofIntel`;
  const baseUrl = "https://roofintel.replit.app";

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={`${baseUrl}${path}`} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={`${baseUrl}${path}`} />
    </Helmet>
  );
}
