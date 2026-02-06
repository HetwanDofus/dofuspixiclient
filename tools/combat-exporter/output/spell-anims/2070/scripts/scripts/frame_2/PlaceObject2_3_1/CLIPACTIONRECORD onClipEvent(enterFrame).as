onClipEvent(enterFrame){
   if(fin == 0)
   {
      if(random(9) == 1)
      {
         vr = (-0.5 + Math.random()) * 40;
      }
      if(t++ > 45)
      {
         angle = Math.atan2(_parent.b._y - _Y,_parent.b._x - _X) * 180 / 3.141592653589793;
         vr = (-0.5 + Math.random()) * 15;
      }
      v = 23 - Math.abs(vr) * 0.5;
      v2 -= (v2 - v) / 3;
      v /= 2;
      v2 /= 2;
      angle += vr;
      angle2 -= (angle2 - angle) / 2;
      _rotation = angle2;
      vx = v2 * 2 * Math.cos(angle2 * 3.141592653589793 / 180);
      vy = v2 * Math.sin(angle2 * 3.141592653589793 / 180);
      boule._xscale = 100 + v2 * 5;
      boule._yscale = 100 - v2 * 2;
   }
   if(Math.abs(_parent.b._y - _Y) < 20 & Math.abs(_parent.b._x - _X) < 20 & fin == 0)
   {
      boule._xscale = 100;
      boule._yscale = 100;
      fin = 1;
      this.play();
      vx = 0;
      cy = 0;
   }
   if(fin == 1)
   {
      this.end();
      fin = 2;
      vx = 0;
      vy = 0;
   }
   _X = _X + vx;
   _Y = _Y + vy;
}
