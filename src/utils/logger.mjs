// src/utils/logger.mjs

export class Logger {
    constructor(prefix = 'PMU API') {
        this.prefix = prefix;
    }
    
    info(message) {
        console.log(`[${this.prefix}] ℹ️  ${message}`);
    }
    
    success(message) {
        console.log(`[${this.prefix}] ✅ ${message}`);
    }
    
    warning(message) {
        console.log(`[${this.prefix}] ⚠️  ${message}`);
    }
    
    error(message) {
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