interface Window {
  pendo?: {
    trackAgent: (eventType: string, metadata: object) => void;
  };
}
declare var pendo: any;
