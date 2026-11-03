import { describe, expect, it } from 'vitest'
import { assertCreditSaleCanChangePaymentMethod } from './creditPayment'

const sale = {
  id: 'sale-1',
  total_amount: 100,
  amount_paid: 40,
  payment_method: 'credit',
}

describe('credit payment method correction', () => {
  it('rejects converting a partially paid credit sale', () => {
    expect(() => assertCreditSaleCanChangePaymentMethod(sale, []))
      .toThrow('Sisa hutang belum lunas')
  })

  it('allows converting credit fully paid at checkout', () => {
    expect(() => assertCreditSaleCanChangePaymentMethod({
      ...sale,
      amount_paid: 100,
    }, [])).not.toThrow()
  })

  it('rejects converting a credit sale with recorded installments', () => {
    expect(() => assertCreditSaleCanChangePaymentMethod({
      ...sale,
      amount_paid: 100,
    }, [{ sale_id: 'sale-1', amount: 40 }]))
      .toThrow('sudah memiliki cicilan')
  })

  it('does not restrict corrections for non-credit sales', () => {
    expect(() => assertCreditSaleCanChangePaymentMethod({
      ...sale,
      payment_method: 'cash',
    }, [])).not.toThrow()
  })
})
