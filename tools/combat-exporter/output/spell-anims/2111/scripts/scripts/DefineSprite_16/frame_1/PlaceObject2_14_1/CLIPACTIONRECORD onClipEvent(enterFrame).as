onClipEvent(enterFrame){
   if(t > 28)
   {
      _parent.gotoAndPlay(2);
   }
   else if(nCurrentFrameState > 0)
   {
      b = a;
      b += v / 3;
      _X = _parent.d + _parent.d * Math.cos(pi + b);
      _Y = _parent.d * Math.sin(b) / size;
      nCurrentFrameState--;
   }
   else
   {
      _X = _parent.d + _parent.d * Math.cos(pi + a);
      _Y = _parent.d * Math.sin(a) / size;
      a += v;
      t++;
      if(t <= 14)
      {
         v -= 0.015;
      }
      else
      {
         v += 0.03;
      }
      nCurrentFrameState = nFramesToIgnore;
   }
}
