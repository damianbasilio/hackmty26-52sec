import { ApiDataSource } from './ApiDataSource';
import type { DataSource } from './DataSource';
import { FixtureDataSource } from './FixtureDataSource';

export type {
  CreateSplitInput,
  DataSource,
  Split,
  SplitParticipant,
  SplitRequest,
  SplitStatus,
  TransactionQuery,
  Transfer,
  TransferInput,
  TransferStatus,
} from './DataSource';
export { ApiDataSource } from './ApiDataSource';
export { FixtureDataSource } from './FixtureDataSource';
export { sharesFor } from './shares';

/** `fixtures` (default) or `api`. The only switch between mock and real data. */
const mode = process.env.EXPO_PUBLIC_DATA_SOURCE ?? 'fixtures';
const engineUrl = process.env.EXPO_PUBLIC_ENGINE_URL ?? 'http://localhost:8000';

export const dataSource: DataSource =
  mode === 'api' ? new ApiDataSource(engineUrl) : new FixtureDataSource();

export const dataSourceMode = mode;
