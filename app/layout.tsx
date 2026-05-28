import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import type { Metadata } from "next";
import Provider from "./provider";

export const metadata: Metadata = {
  title: "Scriptless.ai | Agentic Automation",
  description: "Unlock the power of AI-driven test automation with Scriptless.ai. Our platform empowers you to create, manage, and execute automated tests effortlessly, without writing a single line of code. Experience the future of testing with intelligent agents that adapt to your application's needs, ensuring faster releases and higher quality software.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body style={{ margin: 0, padding: 0 }}>
          <Provider>
            {children}

          </Provider>
        </body>
      </html>
    </ClerkProvider>
  );
}
