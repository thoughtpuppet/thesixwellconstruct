import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { publicCollaborators, renderCollaborators } from '../functions/api/construct/_collaborators.js';

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE content_entities(id TEXT,entity_type TEXT,visibility TEXT);
    CREATE TABLE people(id TEXT,name TEXT,bio TEXT,state TEXT,privacy TEXT);
    CREATE TABLE organizations(id TEXT,name TEXT,description TEXT,state TEXT,website_url TEXT);
    CREATE TABLE collaborator_profiles(entity_id TEXT,slug TEXT,kind_label TEXT,description_label TEXT,pronouns TEXT,sort_order INTEGER,updated_at TEXT,public_visible INTEGER);
    CREATE TABLE media_assets(id TEXT,source_url TEXT,alt_text TEXT,width INTEGER,height INTEGER,caption TEXT,privacy TEXT,state TEXT,public_presentation TEXT,mime_type TEXT);
    CREATE TABLE entity_media(entity_id TEXT,media_id TEXT,role TEXT,alt_text_override TEXT,caption_override TEXT,public_visible INTEGER,sort_order INTEGER);
    CREATE TABLE entity_relationships(source_entity_id TEXT,target_entity_id TEXT,relationship_type_id TEXT,public_visible INTEGER,sort_order INTEGER,id TEXT);
    CREATE TABLE relationship_types(id TEXT,forward_label TEXT,reverse_label TEXT,public_visible INTEGER);
    CREATE TABLE collaborator_credits(entity_id TEXT,event_id TEXT,edition_number TEXT,role TEXT,route TEXT,public_visible INTEGER);
    CREATE TABLE events(id TEXT,title TEXT,publication_state TEXT);
    CREATE TABLE collaborator_links(entity_id TEXT,label TEXT,url TEXT,public_visible INTEGER,sort_order INTEGER);
    INSERT INTO content_entities VALUES('person-tyrone','person','public');
    INSERT INTO people VALUES('person-tyrone','Tyrone Hawk','Supplied biography.','published','public');
    INSERT INTO collaborator_profiles VALUES('person-tyrone','tyrone-hawk','Individual','Filming documentarian','',4,'',1);
  `);
  const add = (id, role, order, overrides = {}) => {
    const values = { privacy:'public', state:'active', public_presentation:'inline', public_visible:1, ...overrides };
    database.prepare('INSERT INTO media_assets VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, `/images/${id}.jpg`, `Alt ${id}`, 1280, 848, '', values.privacy, values.state, values.public_presentation, 'image/jpeg');
    database.prepare('INSERT INTO entity_media VALUES(?,?,?,?,?,?,?)').run('person-tyrone', id, role, '', '', values.public_visible, order);
  };
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async all() { return { results:database.prepare(this.sql).all(...this.values) }; }
  }
  return { database, add, env: { SUBMISSIONS_DB: { prepare:sql => new Statement(sql) } } };
}

test('public profile keeps the main portrait and orders only eligible additional photographs', async () => {
  const { database, add, env } = fixture();
  add('portrait','primary',9);
  add('second-gallery','gallery',2);
  add('first-gallery','gallery',1);
  add('private-source','source',0,{ privacy:'internal', public_visible:0 });
  add('private-gallery','gallery',0,{ privacy:'private' });
  add('hidden-gallery','gallery',0,{ public_presentation:'hidden' });
  add('archived-gallery','gallery',0,{ state:'archived' });
  add('unapproved-gallery','gallery',0,{ public_visible:0 });
  database.prepare("UPDATE media_assets SET source_url='' WHERE id='portrait'").run();
  const response = await publicCollaborators(new Request('https://example.com/api/collaborators/tyrone-hawk'), env, 'tyrone-hawk');
  const { record } = await response.json();
  assert.equal(record.image.url, '/api/construct/entity-media/portrait');
  assert.deepEqual(record.gallery.map(image => image.url), ['/images/first-gallery.jpg','/images/second-gallery.jpg']);
  const html = renderCollaborators({ record });
  assert.ok(html.indexOf('collaborator-bio') < html.indexOf('collaborator-gallery'));
  assert.doesNotMatch(html, /private-source|private-gallery|hidden-gallery|archived-gallery|unapproved-gallery/);
  database.close();
});

test('profile credits retain full role wording, project destinations, and escaped content', () => {
  const html = renderCollaborators({ record: {
    id:'person-tyrone', entityType:'person', name:'Tyrone Hawk', bio:'Bio.', image:null, affiliations:[], credits:[],
    gallery:[{ url:'/photo.jpg', alt:'A <portrait>', caption:'Supplied & approved' }, {url:'javascript:alert(1)',alt:'unsafe'}],
    links:[{url:'/film/#projects',label:'isolated.take · Episode 01 (2023) · Director of Photography'},{url:'/sny-00',label:'SNY00 · November 6, 2026'},{url:'https://example.com',label:'Portfolio'},{url:'javascript:alert(1)',label:'Unsafe'}],
  } });
  assert.match(html, /Director of Photography/);
  assert.match(html, /href="\/sny-00"/);
  assert.match(html, /Collaboration within the Construct/);
  assert.match(html, /Explore their work/);
  assert.match(html, /A &lt;portrait&gt;/);
  assert.match(html, /Supplied &amp; approved/);
  assert.doesNotMatch(html, /javascript:|first KINMARKING edition/);
});
