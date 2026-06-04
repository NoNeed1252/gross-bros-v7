class NFTEngine {
    constructor(client, wallet) {
        this.client = client;
        this.wallet = wallet;
    }

    async findFloorOffers(taxon) {
        const response = await this.client.request({
            command: "nft_buy_offers",
        });
        return response.result.offers || [];
    }

    async acceptOffer(offerIndex) {
        const tx = {
            TransactionType: "NFTokenAcceptOffer",
            Account: this.wallet.address,
            NFTokenBuyOffer: offerIndex
        };
        return await this.client.submitAndWait(tx, { wallet: this.wallet });
    }
}

module.exports = NFTEngine;
