import { httpsCallable } from 'firebase/functions';
import type { OrganizerRequest, OrganizerResponse } from '../../../shared/src/types';
import { functions } from '../../firebase';

const callOrganizer = httpsCallable<OrganizerRequest, OrganizerResponse>(functions, 'organizerAction');
export const organizer = async <Result extends OrganizerResponse>(input: OrganizerRequest) =>
  (await callOrganizer(input)).data as Result;
