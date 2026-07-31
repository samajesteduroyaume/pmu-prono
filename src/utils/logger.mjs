// src/utils/logger.mjs

export class Logger {
    constructor(prefix = 'PMU API') {
        this.prefix = prefix;
        this.isSilent = false;
    }
    
    setSilent(val) { this.isSilent = val; }
    
    debug(message) {
        if (this.isSilent) return;
        console.log(`[${this.prefix}] 🔍 ${message}`);
    }
    
    info(message) {
        if (this.isSilent) return;
        console.log(`[${this.prefix}] ℹ️  ${message}`);
    }
    
    success(message) {
        if (this.isSilent) return;
        console.log(`[${this.prefix}] ✅ ${message}`);
    }
    
    warning(message) {
        if (this.isSilent) return;
        console.log(`[${this.prefix}] ⚠️  ${message}`);
    }
    
    warn(message) {
        this.warning(message);
    }
    
    error(message) {
        if (this.isSilent) return;
        console.error(`[${this.prefix}] ❌ ${message}`);
    }
    
    progress(current, total, message = '') {
        const percentage = ((current / total) * 100).toFixed(1);
        console.log(`[${this.prefix}] [${current}/${total}] (${percentage}%) ${message}`);
    }
    
    header(title) {
        console.log(`\n=== ${title} ===`);
    }
    
    table(data) {
        console.table(data);
    }
}

export default new Logger(); 