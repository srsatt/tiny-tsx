export interface CounterActorContext {
  state: number;
}

export type CounterActorBehavior =
  (context: CounterActorContext, message: number) => string;

export interface ActorOptions {
  mailboxCapacity?: number;
  persistence?: {database: Database; key: string};
  restart?: {maxRestarts: number; withinMs: number};
  supervisor?: SupervisorRef;
}

declare const supervisorRefBrand: unique symbol;

export interface SupervisorRef {
  readonly [supervisorRefBrand]: true;
}

export interface SupervisorOptions {
  strategy: "oneForOne";
  maxRestarts: number;
  withinMs: number;
}

export type ActorPrimitive = string | number | boolean | null;
export type ActorValue = ActorPrimitive | readonly ActorValue[] | {readonly [key: string]: ActorValue};

export interface ValueActorContext<State extends ActorValue> {
  state: State;
}

export type ValueActorBehavior<State extends ActorValue> =
  (context: ValueActorContext<State>, message: State) => string;

export interface ValueActorOptions {
  mailboxCapacity?: number;
}

export interface ActorAskOptions {
  timeoutMs: number;
}

export interface ValueActorRef<Message extends ActorValue> {
  ask(message: Message, options?: ActorAskOptions): Promise<string>;
  tell(message: Message): void;
  stop(): void;
  dispose(): void;
}

export interface CounterActorRef {
  ask(message: number, options?: ActorAskOptions): Promise<string>;
  tell(message: number): void;
  stop(): void;
  dispose(): void;
}

export declare function spawn(
  behavior: CounterActorBehavior,
  initialState: number,
  options?: ActorOptions,
): CounterActorRef;

export declare function spawn<State extends ActorValue>(
  behavior: ValueActorBehavior<State>,
  initialState: State,
  options?: ValueActorOptions,
): ValueActorRef<State>;

export declare function supervise(options: SupervisorOptions): SupervisorRef;
import type {Database} from "tinytsx:sqlite";
