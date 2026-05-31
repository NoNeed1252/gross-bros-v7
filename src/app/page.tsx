export default function Home() {
  return (
    <div className="flex-1 flex flex-col space-y-4 h-full">
      {/* Top Section: NFT Viewer */}
      <section className="flex-1 border border-[#00ff00] p-4 bg-black/50 relative overflow-hidden group">
        <div className="absolute top-0 left-0 p-2 text-[10px] bg-[#00ff00] text-black font-bold">NFT_VIEWER_V1.0</div>
        <div className="flex items-center justify-center h-full border border-dashed border-[#00ff00]/30">
          <p className="text-[#00ff00]/50 animate-pulse">SEARCHING FOR ASSETS...</p>
        </div>
      </section>

      {/* Bottom Section: Chat Console */}
      <section className="h-64 border border-[#00ff00] p-4 bg-black/80 flex flex-col">
        <div className="text-[10px] mb-2 flex justify-between">
          <span>CONSOLE_OUTPUT</span>
          <span className="animate-pulse">● LIVE</span>
        </div>
        <div className="flex-1 overflow-y-auto text-sm space-y-1 mb-2 scrollbar-thin scrollbar-thumb-[#00ff00]">
          <p><span className="text-gray-500">[14:43:01]</span> System: Connection established.</p>
          <p><span className="text-gray-500">[14:43:05]</span> System: Welcome to the Galactic Terminal, Commander.</p>
          <p className="text-[#00ff00]">&gt; _</p>
        </div>
        <div className="flex border-t border-[#00ff00]/30 pt-2">
          <span className="mr-2">&gt;</span>
          <input 
            type="text" 
            className="bg-transparent outline-none flex-1 text-[#00ff00]" 
            placeholder="Enter command..."
          />
        </div>
      </section>
    </div>
  );
}
