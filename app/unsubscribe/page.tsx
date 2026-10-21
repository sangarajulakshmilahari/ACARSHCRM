import UnsubscribeClient from "./UnsubscribeClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return <UnsubscribeClient />;
}
