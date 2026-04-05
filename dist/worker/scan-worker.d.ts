export declare class ScanWorker {
    private isRunning;
    start(): Promise<void>;
    private runLoop;
    private scan;
    stop(): void;
}
export declare const scanWorker: ScanWorker;
