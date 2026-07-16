export type ActorPrimitive = undefined | null | boolean | number | string;
export type ActorValue = ActorPrimitive | readonly ActorValue[] | Readonly<{[key: string]: ActorValue}>;

export interface ActorContext<State extends ActorValue> {
  state: State;
}

export type ActorBehavior<State extends ActorValue, Message extends ActorValue, Reply extends ActorValue> =
  (context: ActorContext<State>, message: Message) => Reply | Promise<Reply>;

export interface ActorOptions {
  mailboxCapacity?: number;
}

export interface ActorRef<Message extends ActorValue, Reply extends ActorValue> {
  ask(message: Message): Promise<Reply>;
  tell(message: Message): boolean;
  stop(): void;
  dispose(): void;
}

export declare function spawn<
  State extends ActorValue,
  Message extends ActorValue,
  Reply extends ActorValue,
>(
  behavior: ActorBehavior<State, Message, Reply>,
  initialState: State,
  options?: ActorOptions,
): ActorRef<Message, Reply>;
