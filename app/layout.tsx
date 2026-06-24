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
        <head>
          <script dangerouslySetInnerHTML={{ __html: `
(function(apiKey){
    (function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
    v=['initialize','identify','updateOptions','pageLoad','track', 'trackAgent'];for(w=0,x=v.length;w<x;++w)(function(m){
    o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
    y=e.createElement(n);y.async=!0;y.src='https://cdn.pendo.io/agent/static/'+apiKey+'/pendo.js';
    z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');
})('2ec81b94-f52b-4998-bb5f-ffa8db6bde58');
` }} />
        </head>
        <body style={{ margin: 0, padding: 0 }}>
          <Provider>
            {children}

          </Provider>
        </body>
      </html>
    </ClerkProvider>
  );
}
