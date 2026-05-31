import type { Metadata } from "next";
import { Inter } from "next/font-family";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Galactic Terminal",
  description: "Secure Galactic Communications & NFT Management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-black text-[#00ff00] min-h-screen flex flex-col font-mono`}>
        {/* Scrolling Marquee Ticker */}
        <div className="bg-[#003300] border-b border-[#00ff00] overflow-hidden whitespace-nowrap py-1">
          <div className="inline-block animate-marquee uppercase text-xs">
            [GALACTIC WARNING] CRITICAL BREACH IN SECTOR 7G ... SOLAR FLARE ALERT IN PROXIMA CENTAURI ... ALL PILOTS REPORT TO FUSION LAB ... [SYSTEM STATUS: NOMINAL] ... 
          </div>
        </div>

        {/* Navigation Tab Bar */}
        <nav className="border-b border-[#00ff00] flex justify-center space-x-8 py-4 bg-black sticky top-0 z-10">
          <button className="hover:bg-[#00ff00] hover:text-black px-4 py-1 border border-transparent hover:border-[#00ff00] transition-colors">TERMINAL</button>
          <button className="hover:bg-[#00ff00] hover:text-black px-4 py-1 border border-transparent hover:border-[#00ff00] transition-colors">FUSION LAB</button>
          <a href="#" className="hover:bg-[#00ff00] hover:text-black px-4 py-1 border border-transparent hover:border-[#00ff00] transition-colors">X (TWITTER)</a>
          <a href="#" className="hover:bg-[#00ff00] hover:text-black px-4 py-1 border border-transparent hover:border-[#00ff00] transition-colors">DISCORD</a>
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col p-4 space-y-4 max-w-6xl mx-auto w-full overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
