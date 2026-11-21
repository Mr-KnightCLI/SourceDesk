export const questions = [
  "How do the two plans differ on response time and support hours?",
  "What is the cancellation notice for Standard?",
  "Do either of these plans include data residency guarantees?",
] as const;

export const samples = [
  {
    id:"standard", name:"Standard support.pdf", location:"Page 2",
    excerpt:"Standard support is staffed Monday through Friday, 9 a.m. to 5 p.m. ET. The initial response target for priority incidents is 8 business hours.",
    cancellation:"Standard subscriptions can be cancelled with 30 days' written notice.",
  },
  {
    id:"premium", name:"Premium support.docx", location:"Support commitments · Paragraph 2",
    excerpt:"Premium support is staffed 24 hours a day, 7 days a week. The initial response target for priority incidents is 2 hours.",
    cancellation:"Premium subscriptions can be cancelled with 60 days’ written notice.",
  },
] as const;

export type Answer = { answer:string; supported:boolean; sources:{number:number;id:string;name:string;location:string;document:string}[] };

export function demoAnswer(question: string, selected: string[] | null): Answer {
  const accessible = (id: string) => selected === null || selected.includes(id);
  function cite(index:number, number:number, cancellation=false) {
    const sample = samples[index];
    return {number,id:sample.id+(cancellation?"-cancellation":""),document:sample.id,name:sample.name,
      location:cancellation?"Page 3":sample.location};
  }
  if (question === questions[0]) {
    const answer: string[] = [];
    const sources: Answer["sources"] = [];
    if (accessible("standard")) {
      sources.push(cite(0,1));
      answer.push("Standard support is available Monday through Friday, 9 a.m. to 5 p.m. ET, with an initial response target of 8 business hours for priority incidents [1].");
    }
    if (accessible("premium")) {
      const n = sources.length+1;
      sources.push(cite(1,n));
      answer.push("Premium support is available 24/7, with an initial response target of 2 hours for priority incidents ["+n+"].");
    }
    if (sources.length) return {answer:answer.join("\n\n"),supported:true,sources};
  }
  if (question === questions[1] && accessible("standard")) {
    return {answer:"Standard subscriptions can be cancelled with 30 days’ written notice [1].",supported:true,sources:[cite(0,1,true)]};
  }
  return {answer:"I couldn’t find enough evidence in the selected documents to answer that question.",supported:false,sources:[]};
}

export function demoExcerpt(id: string) {
  if (id === "standard-cancellation") return samples[0].cancellation;
  if (id === "standard") return samples[0].excerpt.replace(". The ", ".\nThe ");
  return samples.find(sample => sample.id === id)?.excerpt ?? "";
}
