export interface Cart { total: number }

export const total = (cart: Cart): number => cart.total;
