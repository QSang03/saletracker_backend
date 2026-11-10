import { BadRequestException } from '@nestjs/common';

export const normAppointmentCode = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase();

export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function providerTime(value: unknown, required = false): string | null {
  if (value == null && !required) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ||
    !validDate(value.slice(0, 10)) ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  ) {
    throw new Error('Invalid appointment provider datetime');
  }
  return value;
}

export function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new Error('Invalid appointment provider ID');
  return Number(value);
}

export function appointmentRange(from?: string, to?: string) {
  if (
    !from ||
    !to ||
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 366
  ) {
    throw new BadRequestException(
      'from/to phải là ngày hợp lệ YYYY-MM-DD, tối đa 366 ngày',
    );
  }
  return { from, to };
}

export function resolveAppointmentSale(
  code: unknown,
  maps: any[],
  users: any[],
) {
  const source = normAppointmentCode(code);
  if (!source) return { userId: null, status: 'ignored' };
  const matching = maps.filter(
    (m) => m.is_active && String(m.slp_code) === source,
  );
  const candidates = users.filter(
    (u) =>
      !u.deletedAt &&
      matching.some(
        (m) =>
          normAppointmentCode(m.employee_code) ===
          normAppointmentCode(u.employeeCode),
      ),
  );
  if (matching.length !== 1 || candidates.length !== 1) {
    return {
      userId: null,
      status:
        candidates.length > 1 || matching.length > 1
          ? 'ambiguous_sale'
          : 'unmatched_sale',
    };
  }
  return { userId: Number(candidates[0].id), status: 'matched' };
}

export function resolveAppointmentCustomer(
  code: unknown,
  sap: unknown,
  customers: any[],
) {
  if (!normAppointmentCode(code))
    return { customerId: null, status: 'unmatched_customer' };
  const candidates = customers.filter(
    (c) =>
      c.status !== 'deleted' &&
      normAppointmentCode(c.customer_code) === normAppointmentCode(code) &&
      (!normAppointmentCode(sap) ||
        normAppointmentCode(c.sap_code) === normAppointmentCode(sap)),
  );
  return candidates.length === 1
    ? { customerId: Number(candidates[0].id), status: 'matched' }
    : {
        customerId: null,
        status:
          candidates.length > 1 ? 'ambiguous_customer' : 'unmatched_customer',
      };
}

/** Reject partial pages / duplicate IDs before updating ANY stored appointments. */
export function validateAppointmentReport(
  report: any,
): { sale: any; appointment: any }[] {
  if (
    !report ||
    !Array.isArray(report.data) ||
    report.total_sales !== report.data.length ||
    !Number.isSafeInteger(report.total_appointments) ||
    report.total_appointments < 0 ||
    !report.filters ||
    Object.values(report.filters).some((v) => v !== null)
  ) {
    throw new Error('Incomplete or filtered appointment report');
  }
  const result: { sale: any; appointment: any }[] = [];
  const seen = new Set<number>();
  const sales = new Set<number>();
  for (const sale of report.data) {
    const saleId = positiveId(sale.sale_id);
    if (
      sales.has(saleId) ||
      !Array.isArray(sale.completed) ||
      !Array.isArray(sale.not_completed)
    ) {
      throw new Error('Invalid appointment sale group');
    }
    sales.add(saleId);
    const appointments = [...sale.completed, ...sale.not_completed];
    if (sale.summary?.total !== appointments.length)
      throw new Error('Partial appointment sale group');
    for (const appointment of appointments) {
      const id = positiveId(appointment.appointment_id);
      if (seen.has(id)) throw new Error('Duplicate appointment ID');
      seen.add(id);
      if (
        ![
          'pending',
          'approved',
          'checked_in',
          'completed',
          'rejected',
          'cancelled',
          'missed',
        ].includes(appointment.status) ||
        !appointment.customer ||
        (appointment.customer.code != null &&
          typeof appointment.customer.code !== 'string') ||
        (appointment.alerts != null && !Array.isArray(appointment.alerts)) ||
        (appointment.companions != null &&
          !Array.isArray(appointment.companions))
      ) {
        throw new Error('Invalid appointment status/customer');
      }
      providerTime(appointment.scheduled_at, true);
      providerTime(appointment.scheduled_end);
      providerTime(appointment.updated_at, true);
      providerTime(appointment.checkin?.time);
      providerTime(appointment.checkout?.time);
      result.push({ sale, appointment });
    }
  }
  if (result.length !== report.total_appointments)
    throw new Error('Partial appointment report');
  return result;
}
