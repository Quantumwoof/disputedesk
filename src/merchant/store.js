// The merchant's own system of record (orders, shipments, refunds, returns). In DEMO this is a JSON fixture;
// in a real deployment you implement `byTransaction()` against Shopify/WooCommerce/your database (see README).
export class MerchantStore {
  constructor(records, merchant) { this.records = records; this.merchant = merchant; }
  static fromDemo(data) { return new MerchantStore(data.records, data.merchant); }
  static fromJSON(obj) { return new MerchantStore(obj.records, obj.merchant); }
  /** Returns the merchant-side view for a PayPal seller_transaction_id, or null. */
  byTransaction(txId) {
    const rec = this.records[txId];
    if (!rec) return null;
    const order = rec.orders.find((o) => o.transaction_id === txId) ?? null;
    if (!order) return null;
    return {
      merchant: rec.merchant ?? this.merchant,
      order,
      shipment: rec.shipments.find((s) => s.order_id === order.order_id) ?? null,
      refunds: rec.refunds.filter((r) => r.order_id === order.order_id),
      returns: rec.returns.filter((r) => r.order_id === order.order_id),
      siblings: rec.orders.filter((o) => o.order_id !== order.order_id).map((o) => ({ order: o, shipment: rec.shipments.find((s) => s.order_id === o.order_id) ?? null })),
    };
  }
}
