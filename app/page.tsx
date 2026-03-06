"use client";

import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    window.location.href = "/api/auth/login";
  }, []);

  return <p>Loading...</p>;
}
