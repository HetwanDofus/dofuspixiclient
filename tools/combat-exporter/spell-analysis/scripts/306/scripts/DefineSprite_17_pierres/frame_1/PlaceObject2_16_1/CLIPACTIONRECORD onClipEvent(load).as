onClipEvent(load){
   _X = (Math.random() - 0.5) * 10;
   _Y = (Math.random() - 0.5) * 10;
   vx = (Math.random() - 0.5) * 3.5;
   vy = (- Math.random()) * 7.5;
   lim = 50 + (Math.random() - 0.5) * 20;
   _rotation = Math.atan2(vy,vx) * 57.29746936176985;
}
