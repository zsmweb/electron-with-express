// Get dependencies
const express = require('express');
const path = require('path');
const http = require('http');
const bodyParser = require('body-parser');
const socketio = require('socket.io');
const _ = require('lodash');
const uuid = require('uuid');
const actions = require('./actions');

const fs = require('fs');
const app = express();

// Parsers for POST data
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Point static path to dist
app.use(express.static(path.join(__dirname, 'dist')));


// Catch all other routes and return the index file
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/index.html'));
});

/**
 * Get port from environment and store in Express.
 */
const port = process.env.PORT || '3000';
app.set('port', port);

/**
 * Create HTTP server.
 */
const server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */
server.listen(port, () => console.log(`API running on localhost:${port}`));

const io = socketio(server, {'origins': '*:*'} );

const db = {
    posts: {},
    notes: {}
};

var objects = {};

const createNote = (newNote) => {
  newNote.id = uuid.v4();
  if(!newNote.body) newNote.body = [];
  db.notes[newNote.id] = newNote;
  return db.notes[newNote.id];
};


const updateNote = (noteData) => {
  const note = db.notes[noteData.id];
  if(note) {
    db.notes[noteData.id] = _.merge(note, noteData);
    return db.notes[noteData.id];
  } else return undefined;
};

const deleteNote = (id) => {
  if(db.notes[id]){
    delete db.notes[id];
  }
  return id;
};
const SELF = "_SELF";
io.on('connection', (client) => {

    console.log("client connected...");
    client.on('clientinfo',(info)=>{
        console.log(info);
        client.device = info.sn.replace('\n','');
        client.jsonDataPath = "/tmp/"+client.device+"_"+new Date().getTime()+".json";
        console.log(client.jsonDataPath);
        objects[client.device] = [];
        if(info.type == 'phone'){
            client.join(client.device+SELF);
            db[client.device] = {};
            client.emit('getfile',{path:"/sys/srs/srs_cpulevel",watch:true});
            client.emit('getfile',{path:"/sys/srs/srs_gpulevel",watch:true});
            console.log(db)
        }
    });

    client.on("json_data",(json)=>{
      //console.log("json",json,client.device);
      io.in(client.device).emit(actions.FPS,json);
      objects[client.device].push(json);
    });

    client.on("listjson",(o)=>{
      client.emit("listjson",fs.readdirSync("/tmp").filter(x=>{
        if(x.endsWith(".json")){
          return x;
        }
      }))
    });

    client.on('getjson',(o)=>{
      client.emit('getjson',JSON.parse(fs.readFileSync(path.join("/tmp",o.path))));
    });

    client.on('deljson',(o)=>{
      fs.unlinkSync(path.join('/tmp',o.file));
      client.emit("listjson",fs.readdirSync("/tmp").filter(x=>{
        if(x.endsWith(".json")){
          return x;
        }
      }))
    });

    client.on('downloadjson',(o)=>{
      client.emit('downloadjson',{body:JSON.parse(fs.readFileSync(path.join("/tmp",o.file))),file:o.file});
    });

    client.on('data',(d)=>{
      let updatetime=new Date().getTime();
      if (d && d.data) {
        let lines = d.data.split('\n');
        lines.map(line => {
          var ID = null;
          let subs = line.match(/[+-]?[0-9]+/g);
          console.log(subs);
          var digitalarry = [];
          for (const key in subs) {
            digitalarry[key] = parseInt(subs[key],10);
          }
          if (subs && subs.length > 1) {
            ID = subs[0];
          }
          if (ID) {
            var note = {
              username: client.device,
              body: digitalarry,
              srs: ID,
              path: d.path
            }
            var hasnote = null;
            var notes = Object.keys(db.notes);
            for (var i = 0; i < notes.length; i++) {
              let nt = notes[i];
              if (client.device == db.notes[nt].username && d.path == db.notes[nt].path && db.notes[nt].srs == ID) {
                hasnote = db.notes[nt];
                break;
              }
            }
            if (hasnote) {
              if(note.body == hasnote.body){
                note.updatetime=updatetime;
                return;
              }
              note.id = hasnote.id;
              const updatedNote = updateNote(note);
              updatedNote.updatetime=updatetime;
              console.log('update note', updatedNote);
              io.in(note.username).emit(actions.NOTE_UPDATED, updatedNote);
            } else {
              const newNote = createNote(note);
              newNote.updatetime = updatetime;
              console.log('add note', newNote);
              io.in(note.username).emit(actions.NOTE_ADDED, newNote);
            }

          }
        })
        var notes = Object.keys(db.notes);
        for(var i=0;i<notes.length;i++){
          let nt = notes[i];
          let note = db.notes[nt];
          if(client.device == note.username && d.path == note.path){
            console.log(note);
            if(note.updatetime!=updatetime || note.body[3]==0){
              console.log("delete ID", note.id);
              deleteNote(note.id);
              io.in(note.username).emit(actions.NOTE_DELETED, note);
            }
          }
        }
      }
    });

    client.on("join", (data) => {
        console.log(data);
        console.log(`user ${data.username} tries to join ${data.room}`);
        if(Object.keys(db).includes(data.room)){
            console.log(`client joined ${data.room}`);
            client.join(data.room);
            if(data.room=='notes'){
              console.debug('all browser user join notes room!');
              return;
            }
            if(client.cur_room){
              client.leave(client.cur_room);
            }
            client.cur_room = data.room;
            client.user_name = data.username;
        }else{
            console.warn('unknown channel')
            client.emit(actions.ERROR_REPORT,{msg:"unknown channel"});
        }
    });

    client.on(actions.ADD_NOTE, (note) => {
        const newNote = createNote(note);
        console.log('add note', newNote);
        io.in(note.username).emit(actions.NOTE_ADDED, newNote);
    });

    client.on(actions.LIST_NOTES, () => {
      client.emit(actions.NOTES_LISTED, db.notes);
    });

    client.on(actions.UPDATE_NOTE, (note) => {
      const updatedNote = updateNote(note);
      console.log('update note', updatedNote);
      io.in(note.username).emit(actions.NOTE_UPDATED, updatedNote);
      if(updatedNote)
        io.in(updatedNote.username+SELF).emit('cmd',{
          cmd:'srs',
          path:updatedNote.path,
          srs_cfg:updatedNote.body
        });
    });

    client.on(actions.DELETE_NOTE, (note) => {
      console.log("ID", note.id);
      deleteNote(note.id);
      io.in(note.username).emit(actions.NOTE_DELETED, note);
    });


    client.on('disconnect', () => {
      console.log('client disconnected')
      var notes = Object.keys(db.notes);
      for(var i=0;i<notes.length;i++){
        let nt = notes[i];
        let note = db.notes[nt];
        if(client.device == note.username ){
          console.log("ID", note.id);
          deleteNote(note.id);
          io.in('notes').emit(actions.NOTE_DELETED, note);
        }
      }
      if(client.jsonDataPath&&client.device){
        fs.writeFileSync(client.jsonDataPath,JSON.stringify(objects[client.device]));
        delete objects[client.device]
        io.in('notes').emit("listjson",fs.readdirSync("/tmp").filter(x=>{
          if(x.endsWith(".json")){
            return x;
          }
        }))
      }
        
    });

    client.on('getDeviceJson',(o)=>{
      client.emit('getDeviceJson',objects[o.device]);
      console.log(objects[o.device],o.device)
    });
});
