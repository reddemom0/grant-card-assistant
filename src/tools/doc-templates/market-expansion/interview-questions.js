/**
 * Market Expansion Interview Questions Template
 * Based on Readiness Assessment Question Bank - Post-RA Questions
 */

export const INTERVIEW_QUESTIONS = {
  grantType: 'market-expansion',
  documentType: 'interview-questions',

  // Branding configuration
  branding: {
    headerColor: '#0047AB',
    useCleanFormatting: true
  },

  sections: [
    {
      type: 'title',
      text: 'Interview Questions: {{program_name}}',
      style: 'title-branded'
    },
    {
      type: 'paragraph',
      text: '**For use by:** Granted Strategy Team',
      style: 'normal'
    },
    {
      type: 'paragraph',
      text: '**Client:** {{client_name}}',
      style: 'normal'
    },
    {
      type: 'paragraph',
      text: '**Date:** {{interview_date}}',
      style: 'normal'
    },
    {
      type: 'divider'
    },

    {
      type: 'header',
      level: 2,
      text: 'Interview Questions',
      style: 'header-branded'
    },
    {
      type: 'numbered-questions',
      items: [
        'Please provide an elevator pitch for your company. What products or services do you offer?',
        'Do you own the intellectual property for your products/services? What IP protections do you have in place (copyrights, trademarks, patents)?',
        'What is your target market and why did you choose it? What research have you conducted regarding your target export market?',
        'Describe your international growth strategy. What market entry strategies will you employ (e.g., direct sales, distributorship, e-commerce, licensing)?',
        'What are the key activities and milestones for this project? Do you have the necessary production capacity, quality control systems, and distribution channels to support it?',
        'What risks, opportunities, and competitive advantages does your company have? What makes you stand apart from competitors?',
        'Who will be involved in the project? Please outline the roles and responsibilities of each team member.',
        'What are the expected outcomes and ROI for this project? What are your sales projections for international markets (Year 1, Year 2, Year 3)?',
        'Provide an overview of your current financial status. Do you have the necessary financial resources to support this project, or will you require additional funding?',
        'Can you provide a detailed breakdown of your project budget? What are the major cost categories for this export project (marketing, travel, trade shows, consultants, etc.)?'
      ]
    }
  ],

  defaultData: {
    program_name: 'CanExport Innovation',
    client_name: '[Company Name]',
    interview_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  }
};
