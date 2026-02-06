onClipEvent(enterFrame){
   if(t++ == 50)
   {
      this.gotoAndPlay("exp");
      g = 1.5;
      vy = -7;
   }
   if(this._currentframe == 3)
   {
      vx = 15 * (-0.5 + Math.random());
      vy = -3 - 6 * Math.random();
      r = 1 + random(3);
      c = 1;
      while(c < r)
      {
         al = random(10000);
         _parent.attachMovie("plumes","plumes" + al,al);
         eval("_parent.plumes" + al).plume._x = _X;
         eval("_parent.plumes" + al).plume._y = _Y - 20;
         c++;
      }
   }
   _rotation = 5 * vx;
   _X = _X + vx;
   _Y = _Y + vy;
   vy += g;
   vx *= 0.8;
}
