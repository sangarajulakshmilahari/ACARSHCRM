import WebpageDroitHost from "./components/WebpageDroitHost";

export default function WebpageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WebpageDroitHost>{children}</WebpageDroitHost>;
}
