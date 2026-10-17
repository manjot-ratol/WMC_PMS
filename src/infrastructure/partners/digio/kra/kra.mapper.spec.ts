import { toIsoDate } from '../../../../domain/shared/iso-date';
import {
  fromFetchResponse,
  fromRegisterResponse,
  fromStatusResponse,
  toDocumentRequest,
  toPanRequest,
  toRegisterRequest,
} from './kra.mapper';

describe('KRA mapper', () => {
  it('serialises PAN queries with DD/MM/YYYY and omits undefined', () => {
    expect(
      toPanRequest({
        pan: ' abjpm6976j ',
        dob: toIsoDate('1955-08-16'),
        fetchType: 'I',
        uniqueRequestId: 'u1',
        serviceProvider: 'CDSL',
      }),
    ).toEqual({
      pan_no: 'ABJPM6976J',
      dob: '16/08/1955',
      fetch_type: 'I',
      unique_request_id: 'u1',
      service_provider: 'CDSL',
    });
    expect(toPanRequest({ pan: 'ABJPM6976J', uniqueRequestId: 'u2' })).toEqual({
      pan_no: 'ABJPM6976J',
      unique_request_id: 'u2',
    });
  });

  it('builds the registration envelope with common_kra_registration_request and vendor spelling', () => {
    const req = toRegisterRequest({
      uniqueRequestId: 'u3',
      apiRequestType: 'stateless',
      serviceProvider: 'CAMS',
      registration: { pan_no: 'X', martial_status: '01' },
    });
    expect(req).toEqual({
      unique_request_id: 'u3',
      api_request_type: 'stateless',
      service_provider: 'CAMS',
      common_kra_registration_request: { pan_no: 'X', martial_status: '01' },
    });
    expect(req).not.toHaveProperty('register_pan_request');
  });

  it('document request uses DD-MM-YYYY and camelCase kraCode/serviceProvider', () => {
    expect(
      toDocumentRequest({
        pan: 'abjpm6976j',
        dob: toIsoDate('1955-08-16'),
        kraCode: 'CVLKRA',
        serviceProvider: 'CDSL',
      }),
    ).toEqual({
      pan_no: 'ABJPM6976J',
      dob: '16-08-1955',
      kraCode: 'CVLKRA',
      serviceProvider: 'CDSL',
    });
    expect(
      toDocumentRequest({
        pan: 'ABJPM6976J',
        refNo: 'WEBSOLICIT',
        kraCode: 'CVLKRA',
        serviceProvider: 'CDSL',
      }),
    ).toMatchObject({ ref_no: 'WEBSOLICIT' });
  });

  it('maps the documented status response and parses dates', () => {
    const out = fromStatusResponse({
      pan_number: 'ABJPM6976J',
      name: 'VINOD',
      status_code: '007',
      status: 'Validated',
      status_date: '02/06/2023 17:15:24',
      entry_date: '18/06/2013 17:35:19',
      ipv_flag: 'Y',
      ref_id: 'KCA1',
    });
    expect(out).toMatchObject({
      pan: 'ABJPM6976J',
      statusCode: '007',
      status: 'Validated',
      statusDate: '2023-06-02',
      entryDate: '2013-06-18',
      ipvFlag: 'Y',
      refId: 'KCA1',
    });
    expect(out.raw).toBeDefined();
  });

  it('maps the documented fetch response including addresses, kyc and error details', () => {
    const out = fromFetchResponse({
      application_type: 'I',
      personal_information: {
        pan_number: 'ABJPM6939J',
        name: 'VINOD KUMAR SINGH',
        dob: '16/08/1955',
        gender: 'M',
        nationality: '01',
      },
      contact_information: {
        mobile_number: '9999999999',
        email_address: 'ABC@ABC.COM',
        correspondence_address: {
          address_line1: '705',
          city: 'FARIDABAD',
          state: '006',
          country: '101',
          pin_code: '121001',
          address_proof: '09',
          address_proof_date: '28/04/2014',
        },
      },
      financial_information: {
        income: '00',
        occupation: '99',
        political_connection: 'NA',
      },
      kyc_information: {
        status: 'Validated',
        status_code: '007',
        status_date: '02/06/2023 17:15:24',
        ipv_flag: 'Y',
        ipv_date: '13/05/2014',
        internal_reference: 'WEBSOLICIT',
        kyc_mode: '0',
      },
      kra_information: { kra_info: 'CVLKRA', request_date: '22/05/2025' },
      error_details: { error_description: 'ERR-00000' },
      ref_id: 'KCA2',
    });
    expect(out).toMatchObject({
      pan: 'ABJPM6939J',
      dob: '1955-08-16',
      gender: 'M',
      applicationType: 'I',
      mobile: '9999999999',
      email: 'ABC@ABC.COM',
      correspondenceAddress: {
        line1: '705',
        city: 'FARIDABAD',
        stateCode: '006',
        countryCode: '101',
        pinCode: '121001',
        proofCode: '09',
        proofDate: '2014-04-28',
      },
      incomeCode: '00',
      occupationCode: '99',
      politicalConnection: 'NA',
      kyc: {
        status: 'Validated',
        statusCode: '007',
        statusDate: '2023-06-02',
        ipvFlag: 'Y',
        ipvDate: '2014-05-13',
        internalReference: 'WEBSOLICIT',
        kycMode: '0',
      },
      kraInfo: { kra: 'CVLKRA', requestDate: '2025-05-22' },
      error: { description: 'ERR-00000' },
      refId: 'KCA2',
    });
    expect(out.permanentAddress).toBeUndefined();
    expect(fromFetchResponse({}).kyc).toEqual({
      status: undefined,
      statusCode: undefined,
      statusDescription: undefined,
      statusDate: undefined,
      ipvFlag: undefined,
      ipvDate: undefined,
      kycMode: undefined,
      internalReference: undefined,
    });
  });

  it('maps the registration response including column errors', () => {
    const out = fromRegisterResponse({
      request_id: 'KRA1',
      pan_number: 'WLMPT9867F',
      status: 'VALIDATION_ERROR',
      kra_entry_date: '03/07/2025 16:06:02',
      error: {
        error_code: 'ERR-90019',
        error_message: 'INVALID RESIDENCE STATUS',
        additional_errors: [
          { column_name: 'app_residential_status', error_message: 'bad' },
        ],
      },
    });
    expect(out).toMatchObject({
      requestId: 'KRA1',
      status: 'VALIDATION_ERROR',
      kraEntryDate: '2025-07-03',
      error: {
        code: 'ERR-90019',
        columns: [{ column: 'app_residential_status', message: 'bad' }],
      },
    });
    expect(fromRegisterResponse({}).error).toBeUndefined();
  });
});
