import { Client } from 'xrpl';
import fetch from 'node-fetch';

/**
 * Guardian OS v9 - Fusion Gating & Trigger
 * Verifies NFT ownership and signals the IONOS VPS.
 */

const ISSUER = "rP1wMvanhfmsm7Af4FcHvSvfhash43LWSY";
const TAXON = 1;
const VPS_ENDPOINT = "http://216.250.127.169:8080/signal/fusion";
const SHARED_SECRET = process.env.FUSION_SECRET || "CHANGE_ME_NOW";

export default async function handler(req, res) {
  const { action, address, payload_uuid } = req.body;

  if (action === 'check-gate') {
    try {
      const client = new Client("wss://xrplcluster.com");
      await client.connect();
      
      const response = await client.request({
        command: "account_nfts",
        account: address,
        ledger_index: "validated"
      });

      await client.disconnect();

      const nfts = response.result.account_nfts;
      const isHolder = nfts.some(nft => 
        nft.Issuer === ISSUER && nft.NFTokenTaxon === TAXON
      );

      return res.status(200).json({ gated: isHolder });
    } catch (err) {
      return res.status(500).json({ error: 'Gate check failed', message: err.message });
    }
  }

  if (action === 'trigger-fusion') {
    // This is called after a successful Xaman payment verification
    try {
      const response = await fetch(VPS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SHARED_SECRET}`
        },
        body: JSON.stringify({
          source: 'Vercel-Den',
          timestamp: new Date().toISOString(),
          operative: address,
          payload: payload_uuid
        })
      });

      const data = await response.json();
      return res.status(200).json({ status: 'Signal Relay Success', vps_response: data });
    } catch (err) {
      return res.status(502).json({ error: 'VPS Relay Error', message: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid Action' });
}
