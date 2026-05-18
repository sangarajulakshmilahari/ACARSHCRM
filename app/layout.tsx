"use client";

import "./globals.css";
import { Provider } from "react-redux";
import { store } from "../store/store";
import Script from "next/script";
import GlobalAlertProvider from "./components/GlobalAlertProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Font Awesome Kit */}
        <Script
          src="https://kit.fontawesome.com/d02002d519.js"
          crossOrigin="anonymous"
          strategy="beforeInteractive"
        />
      </head>

      <body>
        <Provider store={store}>
          <GlobalAlertProvider>{children}</GlobalAlertProvider>
        </Provider>
      </body>
      
    </html>
  );
}
