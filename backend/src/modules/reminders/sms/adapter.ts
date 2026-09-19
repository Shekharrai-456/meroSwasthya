// REQ-REMIND-002. One interface, two implementations, selected by SMS_MODE -
// nothing in the worker or routes needs to know which one is active.
export interface SmsAdapter {
  send(to: string, text: string): Promise<void>;
}
