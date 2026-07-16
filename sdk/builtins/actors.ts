export interface CounterActorContext {
  state: number;
}

export type CounterActorBehavior =
  (context: CounterActorContext, message: number) => string;

export interface ActorOptions {
  mailboxCapacity?: number;
}

export interface CounterActorRef {
  ask(message: number): Promise<string>;
  tell(message: number): void;
  stop(): void;
  dispose(): void;
}

export declare function spawn(
  behavior: CounterActorBehavior,
  initialState: number,
  options?: ActorOptions,
): CounterActorRef;
