const { xrpToDrops } = require('xrpl');

class AMMEngine {
    constructor(client, wallet) {
        this.client = client;
        this.wallet = wallet;
    }

    async getSwapPath(assetIn, assetOut) {
        const request = {
            command: "ripple_path_find",
            source_account: this.wallet.address,
            destination_account: this.wallet.address,
            destination_amount: assetOut,
            send_max: assetIn
        };
        return await this.client.request(request);
    }

    async executeSwap(takerGets, takerPays) {
        const tx = {
            TransactionType: "OfferCreate",
            Account: this.wallet.address,
            TakerGets: takerGets,
            TakerPays: takerPays,
            Flags: 0x00010000 // Immediate or Cancel
        };
        return await this.client.submitAndWait(tx, { wallet: this.wallet });
    }
}

module.exports = AMMEngine;
