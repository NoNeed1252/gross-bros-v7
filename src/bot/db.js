const { createClient } = require('@supabase/supabase-js');

class Database {
    constructor(url, key) {
        this.client = createClient(url, key);
    }

    async trackState(key, value) {
        const { error } = await this.client
            .from('bot_state')
            .upsert({ key, value, updated_at: new Date() });
        if (error) throw error;
    }

    async logTrade(trade) {
        await this.client.from('trades').insert([trade]);
    }
}

module.exports = Database;
