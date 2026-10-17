import { DigioConfig } from '../../../config/digio.config';
import { DigioHttpClient, DigioRequestOptions } from '../digio-http.client';
import { DigioValidationError } from '../digio.errors';
import { DigioKraConnector, KRA_ENDPOINTS } from './kra.connector';
import {
  KraCheckPanStatusResponse,
  KraFetchDetailsResponse,
  KraPanRequest,
  KraUploadDetailsRequest,
  KraUploadDetailsResponse,
} from './kra.types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type PostCall = [
  string,
  KraPanRequest & KraUploadDetailsRequest,
  DigioRequestOptions,
];

function build(
  post: jest.Mock,
  config: Pick<DigioConfig, 'kraDefaultServiceProvider'> = {},
): DigioKraConnector {
  return new DigioKraConnector({ post } as unknown as DigioHttpClient, config);
}

describe('DigioKraConnector', () => {
  let post: jest.Mock<Promise<unknown>, PostCall>;
  let connector: DigioKraConnector;

  beforeEach(() => {
    post = jest.fn<Promise<unknown>, PostCall>();
    connector = build(post);
  });

  describe('checkPanStatus', () => {
    const response: KraCheckPanStatusResponse = {
      pan_number: 'ABJPM6976J',
      name: 'VINOD KUMAR singh',
      status_code: '007',
      status: 'Validated',
      ref_id: 'KCA25052212000311484ETY7Q83QHQCG',
    };

    it('POSTs to the v2 get_pan_status endpoint with the given body', async () => {
      post.mockResolvedValue(response);

      const result = await connector.checkPanStatus({
        pan_no: 'ABJPM6976J',
        dob: '16/08/1955',
        fetch_type: 'I',
        unique_request_id: 'req-1',
        service_provider: 'CDSL',
      });

      expect(result).toBe(response);
      expect(post).toHaveBeenCalledWith(
        KRA_ENDPOINTS.checkPanStatus,
        {
          pan_no: 'ABJPM6976J',
          dob: '16/08/1955',
          fetch_type: 'I',
          unique_request_id: 'req-1',
          service_provider: 'CDSL',
        },
        { referenceId: 'req-1' },
      );
      expect(KRA_ENDPOINTS.checkPanStatus).toBe(
        '/v3/client/kyc/kra/v2/get_pan_status',
      );
    });

    it('generates unique_request_id and uses it as X_REFERENCE_ID when omitted', async () => {
      post.mockResolvedValue(response);

      await connector.checkPanStatus({ pan_no: 'ABJPM6976J' });

      const [, body, opts] = post.mock.calls[0];
      expect(body.unique_request_id).toMatch(UUID_RE);
      expect(opts.referenceId).toBe(body.unique_request_id);
    });

    it('prefers an explicit referenceId over unique_request_id', async () => {
      post.mockResolvedValue(response);

      await connector.checkPanStatus(
        { pan_no: 'ABJPM6976J', unique_request_id: 'req-1' },
        { referenceId: 'trace-9' },
      );

      expect(post.mock.calls[0][2]).toEqual({ referenceId: 'trace-9' });
    });

    it('upper-cases and trims the PAN', async () => {
      post.mockResolvedValue(response);

      await connector.checkPanStatus({ pan_no: ' abjpm6976j ' });

      expect(post.mock.calls[0][1].pan_no).toBe('ABJPM6976J');
    });

    it('rejects a malformed PAN without calling Digio', async () => {
      await expect(
        connector.checkPanStatus({ pan_no: 'ABC123' }),
      ).rejects.toBeInstanceOf(DigioValidationError);
      expect(post).not.toHaveBeenCalled();
    });

    it('rejects a dob not in DD/MM/YYYY', async () => {
      await expect(
        connector.checkPanStatus({ pan_no: 'ABJPM6976J', dob: '1955-08-16' }),
      ).rejects.toMatchObject({ field: 'dob' });
      expect(post).not.toHaveBeenCalled();
    });

    it('fills service_provider from config default when not supplied', async () => {
      connector = build(post, { kraDefaultServiceProvider: 'CAMS' });
      post.mockResolvedValue(response);

      await connector.checkPanStatus({ pan_no: 'ABJPM6976J' });

      expect(post.mock.calls[0][1].service_provider).toBe('CAMS');
    });
  });

  describe('fetchDetails', () => {
    const response: KraFetchDetailsResponse = {
      application_type: 'I',
      personal_information: { pan_number: 'ABJPM6939J', name: 'VINOD' },
      error_details: { error_description: 'ERR-00000' },
      ref_id: 'KCA2505221202383202QRC23TJWQ7C9U',
    };

    it('POSTs to download_pan and passes deserialize_codes as a query param', async () => {
      post.mockResolvedValue(response);

      const result = await connector.fetchDetails(
        {
          pan_no: 'ABJPM6939J',
          dob: '16/08/1955',
          fetch_type: 'I',
          unique_request_id: 'req-2',
        },
        { deserializeCodes: true },
      );

      expect(result).toBe(response);
      expect(KRA_ENDPOINTS.fetchDetails).toBe(
        '/v3/client/kyc/kra/download_pan',
      );
      expect(post).toHaveBeenCalledWith(
        KRA_ENDPOINTS.fetchDetails,
        expect.objectContaining({ pan_no: 'ABJPM6939J', dob: '16/08/1955' }),
        { referenceId: 'req-2', query: { deserialize_codes: true } },
      );
    });

    it('omits the query when deserializeCodes is not set', async () => {
      post.mockResolvedValue(response);

      await connector.fetchDetails({ pan_no: 'ABJPM6939J', dob: '16/08/1955' });

      expect(post.mock.calls[0][2].query).toBeUndefined();
    });

    it('requires dob (date of birth / incorporation)', async () => {
      await expect(
        connector.fetchDetails({ pan_no: 'ABJPM6939J' }),
      ).rejects.toMatchObject({ field: 'dob' });
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('uploadDetails', () => {
    const response: KraUploadDetailsResponse = {
      service_provider: 'CDSL',
      request_id: 'KRA250703160537962P6R8D86M3QJA4I',
      pan_number: 'WLMPT9867F',
      status: 'VALIDATION_ERROR',
      error: {
        error_message: 'INVALID RESIDENCE STATUS',
        error_code: 'ERR-90019',
      },
    };

    it('POSTs to app/register with common_kra_registration_request', async () => {
      post.mockResolvedValue(response);

      const result = await connector.uploadDetails({
        unique_request_id: 'req-3',
        api_request_type: 'stateless',
        service_provider: 'CDSL',
        common_kra_registration_request: {
          pan_no: 'wlmpt9867f',
          dob_date: '10/06/2001',
          applicant_name: 'ABHAY kr',
          pan_copy: 'N',
          app_exmt_id_proof: '02',
        },
      });

      expect(result).toBe(response);
      expect(KRA_ENDPOINTS.uploadDetails).toBe(
        '/v3/client/kyc/kra/app/register',
      );
      expect(post).toHaveBeenCalledWith(
        KRA_ENDPOINTS.uploadDetails,
        {
          unique_request_id: 'req-3',
          api_request_type: 'stateless',
          service_provider: 'CDSL',
          common_kra_registration_request: {
            pan_no: 'WLMPT9867F',
            dob_date: '10/06/2001',
            applicant_name: 'ABHAY kr',
            pan_copy: 'N',
            app_exmt_id_proof: '02',
          },
        },
        { referenceId: 'req-3' },
      );
    });

    it('generates unique_request_id when omitted', async () => {
      post.mockResolvedValue(response);

      await connector.uploadDetails({
        common_kra_registration_request: { pan_no: 'WLMPT9867F' },
      });

      const [, body, opts] = post.mock.calls[0];
      expect(body.unique_request_id).toMatch(UUID_RE);
      expect(opts.referenceId).toBe(body.unique_request_id);
    });

    it('rejects when common_kra_registration_request is missing', async () => {
      await expect(
        connector.uploadDetails({} as unknown as KraUploadDetailsRequest),
      ).rejects.toMatchObject({ field: 'common_kra_registration_request' });
      expect(post).not.toHaveBeenCalled();
    });

    it('validates dd/mm/yyyy dates inside the registration payload', async () => {
      await expect(
        connector.uploadDetails({
          common_kra_registration_request: {
            pan_no: 'WLMPT9867F',
            dob_date: '2001-06-10',
          },
        }),
      ).rejects.toMatchObject({
        field: 'common_kra_registration_request.dob_date',
      });
      expect(post).not.toHaveBeenCalled();
    });
  });
});
