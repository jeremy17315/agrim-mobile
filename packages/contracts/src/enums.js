"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENCY = exports.NOTIFICATION_TYPES = exports.DELIVERY_STATUSES = exports.MOBILE_MONEY_PROVIDERS = exports.PAYMENT_METHODS = exports.PAYMENT_STATUSES = exports.ORDER_TRANSITIONS = exports.ORDER_STATUSES = exports.ROLES = void 0;
exports.canTransition = canTransition;
exports.ROLES = [
    'CLIENT',
    'LIVREUR',
    'PRODUCTEUR',
    'GESTIONNAIRE',
    'ADMIN',
    'DG',
];
exports.ORDER_STATUSES = [
    'PENDING',
    'CONFIRMED',
    'PREPARING',
    'READY',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED',
];
exports.ORDER_TRANSITIONS = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['PREPARING', 'CANCELLED'],
    PREPARING: ['READY', 'CANCELLED'],
    READY: ['OUT_FOR_DELIVERY', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
};
function canTransition(from, to) {
    return exports.ORDER_TRANSITIONS[from].includes(to);
}
exports.PAYMENT_STATUSES = [
    'PENDING',
    'AWAITING_CONFIRMATION',
    'SUCCEEDED',
    'FAILED',
    'EXPIRED',
    'REFUNDED',
];
exports.PAYMENT_METHODS = [
    'MOBILE_MONEY',
    'CARD',
    'CASH_ON_DELIVERY',
];
exports.MOBILE_MONEY_PROVIDERS = [
    'ORANGE_MONEY',
    'MTN_MOMO',
    'MOOV_MONEY',
    'WAVE',
];
exports.DELIVERY_STATUSES = [
    'UNASSIGNED',
    'ASSIGNED',
    'ACCEPTED',
    'PICKED_UP',
    'IN_TRANSIT',
    'DELIVERED',
    'FAILED',
];
exports.NOTIFICATION_TYPES = [
    'ORDER_CREATED',
    'ORDER_CONFIRMED',
    'ORDER_PREPARING',
    'ORDER_READY',
    'ORDER_OUT_FOR_DELIVERY',
    'ORDER_DELIVERED',
    'ORDER_CANCELLED',
    'DELIVERY_ASSIGNED',
    'PAYMENT_SUCCEEDED',
    'PAYMENT_FAILED',
    'LOW_STOCK',
];
exports.CURRENCY = 'XOF';
//# sourceMappingURL=enums.js.map