export interface GoldRecord {
    timestamp: number;
    price: number;
}

export interface GoldPricePoint {
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

export interface GoldTradingDayData {
    tradingDay: string; // "YYYY-MM-DD" (UTC)
    previousClose: number | null;
    high: number | null;
    low: number | null;
    points: GoldPricePoint[];
}
