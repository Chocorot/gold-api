export interface GoldRecord {
    timestamp: number;
    price: number;
}

export interface GoldCandle {
    date: string;   // "YYYY-MM-DD"
    open: number;
    high: number;
    low: number;
    close: number;
}
