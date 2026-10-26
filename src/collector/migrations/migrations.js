import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_reference_data.sql';
import m0002 from './0002_schedule_versions.sql';
import m0003 from './0003_fix_details_and_timetable.sql';
import m0004 from './0004_arrival_predictions.sql';
import m0005 from './0005_prediction_source.sql';
import m0006 from './0006_matched_slots.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006
    }
  }
  