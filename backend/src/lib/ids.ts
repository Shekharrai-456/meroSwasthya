import { v5 as uuidv5 } from 'uuid';

// REQ-PREG-004, REQ-SYNC-023, backend.md A.8#15: AncContact ids are
// deterministic (uuid v5) on both client and server, from the SAME fixed
// namespace and name format, so a pregnancy created offline and its 8
// contacts never duplicate the server-generated set once synced. The
// namespace is the literal value backend.md/frontend.md both specify -
// itself just a fixed, arbitrary UUID used as a v5 namespace (it happens to
// be the RFC 4122 example DNS namespace, reused here only because the spec
// names this exact value, not because of what it originally meant).
const ANC_CONTACT_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export function ancContactId(pregnancyId: string, contactNo: number): string {
  return uuidv5(`${pregnancyId}:${contactNo}`, ANC_CONTACT_NAMESPACE);
}
