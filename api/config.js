module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    xamanApiKey: process.env.XAMAN_API_KEY || process.env.NEXT_PUBLIC_XAMAN_API_KEY || '',
    fusionTreasuryAddress: process.env.FUSION_TREASURY_ADDRESS || process.env.NEXT_PUBLIC_FUSION_TREASURY_ADDRESS || '',
  });
};
