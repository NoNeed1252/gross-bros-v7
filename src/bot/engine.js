const { Client, Wallet } = require('xrpl');
const AMMEngine = require('./amm');
const NFTEngine = require('./nft');
const Database = require('./db');

class UnifiedXRPLBot {
    constructor(config) {
        this.client = new Client(config.xrplUrl);
        this.wallet = Wallet.fromSeed(config.seed);
        this.db = new Database(config.supabaseUrl, config.supabaseKey);
        this.amm = new AMMEngine(this.client, this.wallet);
        this.nft = new NFTEngine(this.client, this.wallet);
    }

    async start() {
        await this.client.connect();
        console.log(`Bot started for address: ${this.wallet.address}`);
    }

    async monitorNFTFloor(taxon, targetPrice) {
        console.log(`Monitoring floor for taxon ${taxon}...`);
        setInterval(async () => {
            try {
                const offers = await this.nft.findFloorOffers(taxon);
                const bestOffer = offers.sort((a, b) => a.amount - b.amount)[0];
                
                if (bestOffer && bestOffer.amount <= targetPrice) {
                    console.log('Target hit! Sniping NFT...');
                    await this.nft.acceptOffer(bestOffer.index);
                    await this.db.logTrade({ type: 'NFT_SNIPE', taxon, price: bestOffer.amount });
                }
            } catch (err) {
                console.error('NFT monitor error:', err);
            }
        }, 10000); // 10s interval
    }

    async stop() {
        await this.client.disconnect();
    }
}

module.exports = UnifiedXRPLBot;
